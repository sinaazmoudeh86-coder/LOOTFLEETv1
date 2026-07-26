/* =============================================================================
   starforge.js — STARFORGE (Command ▸ Starforge) — ITEM ENHANCEMENT
   -----------------------------------------------------------------------------
   Per-ITEM enhancement: the gear-side sibling of Ship Ascension and a gold /
   iron / plasma sink with real gambling tension.

     • TEMPER (+0 → +15): every strike costs Gold + Iron and rolls a published
       success chance — gentle to +5, then a steep geometric collapse (60% at
       +5 down to ~12% at +15). Each level bakes +6% into the item's combat
       stats (damage, hull, fire rate, crit damage, thrust).
       - FORGE HEAT (pity): every failure adds +3% success to the NEXT strike on
         that item (cap +45%). Success resets the heat.
       - SLIP RISK: above +10, a failed strike has a 40% chance to knock the
         temper down one level — but never below the +10 checkpoint.
     • AT +15: the fitting is cryo-hardened — +1% chance on hit to flash-freeze
       the target solid (FrostyFrost tech). Stacks across every +15 slot; bosses
       are immune. Surfaces as stats.cryoChance in game-v93 computeStats.
     • PURITY (60–130%): latent forge purity multiplies the whole temper bonus.
       Rerolling costs Plasma and REPLACES the old roll — pure gamble — but the
       minimum possible roll creeps up +1% per reroll (to 95%). 125%+ = PRISTINE.

   Enhancement lives ON the item (it.enh) and is baked into it.stats, so it
   counts everywhere — flagship, escorts, power score, auto-equip — and is LOST
   with the item (death drops, selling). State rides the normal save.
   ========================================================================== */
(function () {
  'use strict';
  const G = () => window.GAME;
  const C = () => window.CONFIG;
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  function fmt(n) { if (!Number.isFinite(n)) return '—'; try { return G().formatNum(Math.floor(n)); } catch (e) { return Math.floor(n) + ''; } }

  const BOOST = ['attackDamage', 'health', 'attackSpeed', 'critDamage', 'moveSpeed'];
  const MAX_LV = 15, SLIP_FLOOR = 10, PRISTINE = 125, PCT_PER_LV = 6;
  function bank(res) { const st = G().state; return res === 'gold' ? (st.gold || 0) : ((st.resources || {})[res] || 0); }

  // ---- item enhancement state -----------------------------------------------
  function ensure(it) {
    if (!it.enh) {
      const base = {};
      BOOST.forEach((k) => { if (it.stats && it.stats[k] != null) base[k] = it.stats[k]; });
      it.enh = { lv: 0, heat: 0, pur: 100, rr: 0, n0: it.name, base };
    }
    return it.enh;
  }
  function mult(e) { return 1 + (PCT_PER_LV / 100) * e.lv * (e.pur / 100); }
  function recompute(it) {
    const e = it.enh; if (!e) return;
    const m = mult(e);
    for (const k in e.base) {
      const v = e.base[k] * m;
      it.stats[k] = (k === 'attackDamage' || k === 'health') ? Math.max(1, Math.round(v)) : Math.round(v * 10) / 10;
    }
    it.name = e.n0 + (e.lv > 0 ? ' +' + e.lv : '');
  }
  // ODDS: gentle to +5, then a steep geometric collapse — each strike past +5 is
  // ~16% harder than the last (60% → 12% at +15). Heat pity is the counterweight.
  function chance(e) {
    const base = e.lv < 5 ? [100, 95, 90, 85, 80][e.lv] : Math.max(8, 60 * Math.pow(0.84, e.lv - 5));
    return clamp(Math.round(base + e.heat), 5, 100);
  }
  // ---- PRICING ---------------------------------------------------------------
  // FIXED COSTS — never a share of your balance. A strike's price is a pure
  // function of three things: your PILOT LEVEL (which sets the economic tier),
  // the fitting's RARITY, and its ITEM LEVEL — then the temper level it's
  // climbing to. Two pilots at the same level forging the same item always pay
  // the same. Every term is log/polynomial-bounded, so nothing can overflow the
  // way the old exponential ILVL tariff did (2^2022 = Infinity at ILVL 250k).
  const COST_CAP = 1e295;
  const fin = (n, alt) => (Number.isFinite(n) && n > 0 ? Math.min(n, COST_CAP) : (alt || 1));
  const plv = () => Math.max(1, G().state.level | 0);
  const izone = (it) => {
    // ECONOMIC ZONE — the deepest zone this pilot has ACTUALLY reached, capped
    // by the item's own drop zone. Pricing off the item's zone alone breaks on
    // gear that arrived by event/reward: a zone-500 fitting priced at zone-500
    // yield asks millions of times what a pilot farming zone 3 will ever hold.
    const st = G().state;
    const reached = Math.max(1, st.highestDungeonReached | 0, st.highestUnlocked | 0, st.currentDungeon | 0);
    return Math.max(1, Math.min(1000, Math.min((it.dungeon | 0) || 1, reached)));
  };
  // PILOT LEVEL — a flat difficulty ramp across the whole game (×1 → ×1.5 at 500)
  const lvlF = () => 1 + plv() / 1000;
  // gold economy is geometric in ZONE — anchor to what one kill pays there
  function econGold(it) { try { return fin(C().enemyGold(izone(it)), 1000); } catch (e) { return 1000; } }
  // iron/plasma economies are polynomial, not geometric — priced separately
  function econRes(it) { return fin(Math.pow(1 + izone(it), 1.6), 1); }
  function ilvlMult(it) { const L = Math.max(1, it.ilvl | 0); return fin(Math.pow(1 + Math.log10(1 + L), 0.35), 1); }
  function tariff(it) {
    const L = it.ilvl | 0;
    return L > 300 ? fin(0.25 * Math.log10(L / 300), 0) : 0;   // surcharge only: ILVL 3,000 +25% · 250,000 +73%
  }
  // RARITY PREMIUM — a Primordial fitting costs ~3× a Common one to work.
  function rarMult(it) { return Math.pow(1.18, it.rarity || 0); }
  function zr(it) { return fin(rarMult(it) * ilvlMult(it) * (1 + tariff(it)) * lvlF(), 1); }
  // NO BANK-SHARE CEILING. An earlier build clamped every strike to a share of
  // your current gold — that silently turned the model back into %-of-balance
  // pricing (farm gold → price rises; spend it → price falls; nothing ever
  // gates). The formula below IS the price, full stop. When you can't afford it
  // the Strike button says exactly how much more you need and roughly how many
  // kills that is — unaffordable is a gate you can farm through, not a wall.
  const floorAt = (v, fl) => Math.max(fl, Math.floor(fin(v, fl)));
  // costs are computed ONCE per render and reused on click, so the price shown
  // is exactly the price charged
  let _cCache = {};
  const ckey = (it, kind) => { const e = ensure(it); return (it.id || it.name) + '|' + kind + '|' + e.lv + '|' + e.rr; };
  function costT(it) {
    const k = ckey(it, 't'); if (_cCache[k]) return _cCache[k];
    const e = ensure(it), m = zr(it), step = Math.pow(1.25, e.lv);
    return (_cCache[k] = {
      gold: floorAt(econGold(it) * 40 * m * step, 1000),      // ≈ 40 kills in the item's zone × difficulty
      iron: floorAt(250 * econRes(it) * m * step, 100),
    });
  }
  function costR(it) {
    const k = ckey(it, 'r'); if (_cCache[k]) return _cCache[k];
    const e = ensure(it), m = zr(it);
    return (_cCache[k] = { plasma: floorAt(150 * econRes(it) * m * Math.pow(1.25, e.rr), 200) });
  }
  // "you need X more ● — about N kills in Zone Z" — makes the gate legible
  function shortfall(it, c) {
    const need = [];
    const gGap = c.gold - bank('gold'), iGap = (c.iron || 0) - bank('iron');
    if (gGap > 0) need.push('<span style="color:#f2b24b">● ' + fmt(gGap) + '</span>');
    if (iGap > 0) need.push('<span style="color:#d0a060">◆ ' + fmt(iGap) + '</span>');
    if (!need.length) return '';
    const z = izone(it);
    let kills = 0;
    try { kills = Math.ceil(gGap / Math.max(1, C().enemyGold(z))); } catch (e) {}
    return '<div class="fg-short">Need ' + need.join(' + ') +
      (gGap > 0 && kills > 0 ? ' — about <b>' + fmt(kills) + '</b> kills in Zone ' + z : '') + '</div>';
  }
  function purFloor(e) { return Math.min(95, 60 + e.rr); }

  // ===========================================================================
  // RENDER
  // ===========================================================================
  let sel = null, busy = false;
  function baseSlot(k) { return k.replace(/\d+$/, ''); }
  function fmtStat(k, v) { const def = C().STATS[k] || {}; return def.fmt === 'flat' ? fmt(v) : (Math.round(v * 10) / 10) + '%'; }

  const UNLOCK_LV = 100;
  function render() {
    _cCache = {};   // reprice once per paint; the click then charges exactly what was shown
    const body = $('forge-body'); if (!body) return;
    const st = G().state;
    // gated at Lv 100 — the lock veil (game.html #lock-forge) explains the system
    // while you climb, so leave the body empty rather than teasing a live panel
    if ((st.level | 0) < UNLOCK_LV) { body.innerHTML = ''; const s0 = $('forge-sub'); if (s0) s0.textContent = 'Lv ' + UNLOCK_LV; return; }
    const slots = Object.keys(st.equipped || {}).filter((k) => st.equipped[k]);
    const sub = $('forge-sub'); if (sub) sub.textContent = slots.length ? slots.length + ' fittings docked' : '';
    if (!slots.length) { body.innerHTML = '<div class="fg-empty">Nothing to temper — the forge works on <b>equipped</b> fittings. Deploy, loot, equip, then bring your keepers here.</div>'; return; }
    if (!sel || !st.equipped[sel]) sel = slots[0];
    body.innerHTML =
      '<div class="fg-intro">Hammer <b>+6% combat stats</b> into a fitting per temper level — odds fall as the temper climbs. Failures build <b>Forge Heat</b> (+3% next strike). Past <b>+10</b> a miss can <b>slip a level</b>. Reroll <b>Purity</b> (60–130%) with plasma to multiply the whole temper. Costs are <b>fixed</b> — set by your <b>pilot level</b>, the fitting’s <b>rarity</b> and its <b>item level</b> — <i>ILVL 300+ pays a steep endgame tariff</i>. The work lives on the item — lose the item, lose the work. Every fitting at <b>+15</b> adds <b style="color:#aee6ff">❄ 1% flash-freeze</b> on hit (bosses immune) — they stack across slots.</div>' +
      '<div class="fg-strip">' + slots.map(chip).join('') + '</div>' +
      dash(sel);
    wire(body);
  }

  function chip(k) {
    const it = G().state.equipped[k], r = C().RARITY[it.rarity] || C().RARITY[0];
    const e = it.enh || { lv: 0 };
    const sl = C().SLOTS[baseSlot(k)] || {};
    return '<button class="fg-chip' + (k === sel ? ' on' : '') + '" data-sel="' + k + '" style="--rc:' + r.color + '">' +
      '<span class="fg-chip-ic">' + (it.icon || '') + '</span>' +
      '<span class="fg-chip-n">' + it.name + '</span>' +
      '<span class="fg-chip-s">' + (sl.name || k) + (e.lv ? ' · <b>+' + e.lv + '</b>' : '') + '</span>' +
    '</button>';
  }

  function dash(k) {
    const st = G().state, it = st.equipped[k], e = ensure(it);
    const r = C().RARITY[it.rarity] || C().RARITY[0];
    const noBase = !Object.keys(e.base).length;
    const statRows = Object.keys(e.base).map((sk) => {
      const def = C().STATS[sk] || { name: sk };
      const bonus = (it.stats[sk] || 0) - e.base[sk];
      return '<div class="fg-stat"><span>' + def.name + '</span><b>' + fmtStat(sk, e.base[sk]) + (bonus > 0.01 ? ' <i>+' + fmtStat(sk, bonus) + '</i>' : '') + '</b></div>';
    }).join('');
    return '<div class="fg-dash" id="fg-dash" style="--rc:' + r.color + '" data-comment-anchor="fg-dash">' +
      '<div class="fg-hero">' +
        '<span class="fg-hero-ic">' + (it.icon || '') + '</span>' +
        '<div class="fg-hero-t">' +
          '<div class="fg-hero-n">' + it.name + '</div>' +
          '<div class="fg-hero-badges">' +
            '<span class="fg-rar">' + (r.name || '').toUpperCase() + '</span>' +
            '<span class="fg-b">TEMPER <b>+' + e.lv + '</b><i>/' + MAX_LV + '</i></span>' +
            (e.lv >= MAX_LV ? '<span class="fg-b cryo">❄ FREEZE <b>1%</b></span>' : '') +
            '<span class="fg-b">ILVL <b>' + (it.ilvl | 0) + '</b></span>' +
            (it.rarity ? '<span class="fg-b">RARITY COST <b>×' + (rarMult(it) < 10 ? rarMult(it).toFixed(1) : Math.round(rarMult(it))) + '</b></span>' : '') +
            (tariff(it) ? '<span class="fg-b tar">FORGE TARIFF <b>×' + (1 + tariff(it)).toFixed(2) + '</b></span>' : '') +
            '<span class="fg-b' + (e.pur >= PRISTINE ? ' pris' : '') + '">PURITY <b>' + e.pur + '%</b></span>' +
          '</div>' +
        '</div>' +
      '</div>' +
      (statRows ? '<div class="fg-stats">' + statRows + '</div>' : '') +
      '<div class="fg-grid">' + temperPanel(k, it, e, noBase) + purityPanel(k, it, e, noBase) + '</div>' +
    '</div>';
  }

  function temperPanel(k, it, e, noBase) {
    const maxed = e.lv >= MAX_LV, ch = chance(e), c = costT(it);
    const afford = bank('gold') >= c.gold && bank('iron') >= c.iron;
    const chCls = ch >= 75 ? 'hi' : ch >= 40 ? 'mid' : 'lo';
    const pips = Array.from({ length: MAX_LV }, (_, i) => '<i class="' + (i < e.lv ? 'on' : '') + (i >= SLIP_FLOOR ? ' risk' : '') + '"></i>').join('');
    let inner;
    if (noBase) inner = '<div class="fg-nobase">This fitting has no temperable stats — the forge boosts damage, hull, fire rate, crit damage &amp; thrust lines.</div>';
    else if (maxed) inner = '<div class="fg-maxed">✦ +15 — TEMPERED TO THE LIMIT<span class="fg-cryo">❄ +1% FLASH-FREEZE ON HIT</span></div>';
    else inner =
      '<div class="fg-chance ' + chCls + '"><span>SUCCESS</span><b>' + ch + '%</b>' +
        (e.heat ? '<em class="fg-heat">🔥 HEAT +' + e.heat + '%</em>' : '') +
        '<div class="fg-chbar"><i style="width:' + ch + '%"></i></div></div>' +
      '<div class="fg-next">+' + e.lv + ' → <b>+' + (e.lv + 1) + '</b> · total <b>+' + Math.round(PCT_PER_LV * (e.lv + 1) * e.pur / 100) + '%</b> stats' + (e.lv + 1 >= MAX_LV ? ' · <b style="color:#aee6ff">❄ +1% freeze</b>' : '') + '</div>' +
      '<div class="fg-cost">' +
        '<span style="color:#f2b24b' + (bank('gold') < c.gold ? ';opacity:.45' : '') + '">● ' + fmt(c.gold) + '</span>' +
        (c.iron > 0 ? '<span style="color:#d0a060' + (bank('iron') < c.iron ? ';opacity:.45' : '') + '">◆ ' + fmt(c.iron) + '</span>' : '') +
      '</div>' +
      '<button class="fg-btn" data-temper="' + k + '"' + (afford ? '' : ' disabled') + '>⚒ STRIKE</button>' +
      (afford ? '' : shortfall(it, c)) +
      '<div class="fg-note">' + (e.lv >= SLIP_FLOOR ? 'Above +10 a miss has a 40% chance to slip one level (never below +10)' : 'Fail costs only the materials — heat carries to your next strike') + (tariff(it) ? ' · ILVL ' + (it.ilvl | 0) + ' pays the ×' + (1 + tariff(it)).toFixed(2) + ' endgame tariff' : '') + '</div>';
    return '<div class="fg-panel" id="fg-temper"><div class="fg-panel-h">⚒ TEMPER</div><div class="fg-pips">' + pips + '</div>' + inner + '</div>';
  }

  function purityPanel(k, it, e, noBase) {
    const c = costR(it), afford = bank('plasma') >= c.plasma;
    const fl = purFloor(e);
    const pos = clamp((e.pur - 60) / (130 - 60) * 100, 0, 100);
    let inner;
    if (noBase) inner = '<div class="fg-nobase">Purity multiplies the temper — nothing to multiply on this fitting.</div>';
    else inner =
      '<div class="fg-pur' + (e.pur >= PRISTINE ? ' pris' : '') + '"><b>' + e.pur + '%</b><span>' + (e.pur >= PRISTINE ? '✦ PRISTINE' : 'forge purity') + '</span></div>' +
      '<div class="fg-purbar"><i class="fg-pfloor" style="left:' + clamp((fl - 60) / 70 * 100, 0, 100) + '%"></i><i class="fg-ppris"></i><b style="left:' + pos + '%"></b></div>' +
      '<div class="fg-next">effective <b>+' + (PCT_PER_LV * e.pur / 100).toFixed(1) + '%</b> per temper level</div>' +
      (c.plasma > 0 ? '<div class="fg-cost"><span style="color:#c07bff' + (afford ? '' : ';opacity:.45') + '">✦ ' + fmt(c.plasma) + '</span></div>' : '') +
      '<button class="fg-btn pur" data-reroll="' + k + '"' + (afford ? '' : ' disabled') + '>↻ REROLL PURITY</button>' +
      (afford ? '' : '<div class="fg-short">Need <span style="color:#c07bff">✦ ' + fmt(c.plasma - bank('plasma')) + '</span> more plasma</div>') +
      '<div class="fg-note">New roll REPLACES the old · minimum roll ' + fl + '% (creeps +1 per reroll, to 95%) · 125%+ is PRISTINE</div>';
    return '<div class="fg-panel" id="fg-purity"><div class="fg-panel-h">✦ PURITY</div>' + inner + '</div>';
  }

  function wire(body) {
    body.querySelectorAll('[data-sel]').forEach((b) => b.onclick = () => { sel = b.dataset.sel; render(); });
    body.querySelectorAll('[data-temper]').forEach((b) => b.onclick = () => attempt(b.dataset.temper));
    body.querySelectorAll('[data-reroll]').forEach((b) => b.onclick = () => reroll(b.dataset.reroll));
  }

  // ===========================================================================
  // ACTIONS
  // ===========================================================================
  function attempt(k) {
    if (busy) return;
    const st = G().state, it = st.equipped[k]; if (!it) return;
    const e = ensure(it);
    if (e.lv >= MAX_LV || !Object.keys(e.base).length) return;
    const c = costT(it);
    if (bank('gold') < c.gold || bank('iron') < c.iron) return;
    busy = true;
    st.gold -= c.gold;
    st.resources = st.resources || { fuel: 0, iron: 0, plasma: 0 };
    st.resources.iron -= c.iron;
    const ok = Math.random() * 100 < chance(e);
    let slipped = false;
    if (ok) { e.lv++; e.heat = 0; }
    else {
      e.heat = Math.min(45, e.heat + 3);
      if (e.lv > SLIP_FLOOR && Math.random() < 0.4) { e.lv--; slipped = true; }
    }
    recompute(it);
    finish('fg-temper', () => {
      flashText('fg-temper', ok, ok ? (e.lv >= MAX_LV ? '★ MAX TEMPER +' + e.lv : 'SUCCESS · +' + e.lv) : slipped ? 'MISS · SLIPPED TO +' + e.lv : 'MISS · 🔥 HEAT +' + e.heat + '%');
      if (ok && e.lv >= MAX_LV) { try { G().bumpLife('temper15', 1); G().save(); } catch (x) {} }   // MASTER ARMOURER badge
      if (ok && e.lv >= MAX_LV) showCine(it, '⚒ +15 TEMPER', 'CRYO-HARDENED · +1% FLASH-FREEZE', '#ffab4a');
    });
  }

  function reroll(k) {
    if (busy) return;
    const st = G().state, it = st.equipped[k]; if (!it) return;
    const e = ensure(it);
    if (!Object.keys(e.base).length) return;
    const c = costR(it);
    if (bank('plasma') < c.plasma) return;
    busy = true;
    st.resources = st.resources || { fuel: 0, iron: 0, plasma: 0 };
    st.resources.plasma -= c.plasma;
    const old = e.pur;
    e.rr++;
    const fl = purFloor(e);
    e.pur = Math.round(fl + Math.random() * (130 - fl));
    recompute(it);
    finish('fg-purity', () => {
      const up = e.pur >= old;
      flashText('fg-purity', up, old + '% → ' + e.pur + '%' + (e.pur >= PRISTINE ? ' ✦ PRISTINE' : ''));
      if (e.pur >= PRISTINE) { try { G().bumpLife('pristine', 1); G().save(); } catch (x) {} }      // PRISTINE FORGE badge
      if (e.pur >= PRISTINE) showCine(it, '✦ ' + e.pur + '% PURITY', 'PRISTINE FORGE', '#7df3ff');
    });
  }

  function finish(panelId, after) {
    try { G().refreshStats(); G().save(); } catch (e) {}
    if (window.UI && window.UI.refreshAll) window.UI.refreshAll();
    const p = $(panelId); if (p) p.classList.add('charging');
    setTimeout(() => { busy = false; render(); after(); }, 380);
  }

  function flashText(panelId, ok, text) {
    const p = $(panelId); if (!p) return;
    p.classList.add(ok ? 'flash-ok' : 'flash-no');
    const tag = document.createElement('div');
    tag.className = 'fg-flash ' + (ok ? 'ok' : 'no');
    tag.textContent = text;
    p.appendChild(tag);
    if (!ok) { const d = $('fg-dash'); if (d) { d.classList.add('shake'); setTimeout(() => d.classList.remove('shake'), 500); } }
    setTimeout(() => { tag.remove(); p.classList.remove('flash-ok', 'flash-no'); }, 1300);
  }

  function showCine(it, big, kicker, color) {
    let o = $('fg-overlay');
    if (!o) { o = document.createElement('div'); o.id = 'fg-overlay'; ($('screen-forge') || document.body).appendChild(o); }
    o.className = 'show';
    o.innerHTML = '<div class="fg-cine" style="--tc:' + color + '">' +
      '<div class="fg-cine-rings"><i></i><i></i><i></i></div>' +
      '<span class="fg-cine-ic">' + (it.icon || '') + '</span>' +
      '<div class="fg-cine-k">' + kicker + '</div>' +
      '<div class="fg-cine-big">' + big + '</div>' +
      '<div class="fg-cine-n">' + it.name + '</div>' +
      '<button class="fg-cine-btn">GLORIOUS</button></div>';
    o.querySelector('.fg-cine-btn').onclick = () => { o.classList.remove('show'); o.innerHTML = ''; render(); };
  }

  // ---- BOOT ------------------------------------------------------------------
  function boot() { if (!$('fg-css')) { const s = document.createElement('style'); s.id = 'fg-css'; s.textContent = CSS; document.head.appendChild(s); } }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  window.STARFORGE = { render };

  const CSS = `
  .mega-grid .mega-card.cmd-forge{ background:linear-gradient(180deg,#26130a,#140b08); }
  .mega-grid .mega-card.cmd-forge .mc-ic{ color:#ffab4a; border-color:rgba(255,171,74,.5); background:radial-gradient(120% 120% at 50% 0%,#38200e,#140b08); box-shadow:0 0 14px -3px rgba(255,171,74,.7); }
  .mega-grid .mega-card.cmd-forge .mc-n{ color:#ffe2c0; }
  .mega-grid .mega-card.cmd-forge::before{ background:linear-gradient(130deg,#ffab4a,#ff5f3d,#ffd24d,#ffab4a); background-size:250% 250%; }
  #screen-forge .scr-title{ color:#ffab4a; }
  #forge-body{ padding:12px; }
  .fg-intro{ font-size:12px; color:#9fb1c4; line-height:1.55; background:linear-gradient(180deg,#181109,#100b07); border:1px solid #3a2a17; border-radius:12px; padding:11px 13px; margin-bottom:12px; }
  .fg-intro b{ color:#ffd9ae; }
  .fg-intro i{ font-style:normal; color:#ff9aa3; }
  .fg-empty{ font-size:12.5px; color:#8ba0b5; text-align:center; padding:40px 16px; border:1px dashed #2b4055; border-radius:14px; margin:12px; line-height:1.6; }
  .fg-empty b{ color:#ffd9ae; }

  .fg-strip{ display:flex; gap:8px; overflow-x:auto; padding:2px 2px 10px; margin-bottom:4px; scrollbar-width:thin; }
  .fg-chip{ flex:none; width:96px; border:1px solid #223245; border-radius:12px; padding:8px 6px; cursor:pointer; text-align:center;
    background:linear-gradient(180deg,#0e1725,#0b1220); display:flex; flex-direction:column; align-items:center; gap:3px; transition:border-color .15s, box-shadow .15s; }
  .fg-chip-ic{ width:30px; height:30px; color:var(--rc); display:grid; place-items:center; }
  .fg-chip-ic svg{ width:26px; height:26px; }
  .fg-chip-n{ font-family:'Orbitron',sans-serif; font-weight:700; font-size:8px; color:#dbe8f5; letter-spacing:.02em; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .fg-chip-s{ font-size:8px; font-weight:800; letter-spacing:.06em; color:var(--rc); text-transform:uppercase; }
  .fg-chip-s b{ color:#ffab4a; }
  .fg-chip.on{ border-color:var(--rc); box-shadow:0 0 14px -4px var(--rc); }

  .fg-dash{ border:1px solid color-mix(in srgb,var(--rc) 45%,#223245); border-radius:16px; padding:13px; position:relative; overflow:hidden;
    background:linear-gradient(180deg, color-mix(in srgb,var(--rc) 7%,#0e1725), #0a101c); }
  .fg-dash::after{ content:''; position:absolute; inset:0 0 auto 0; height:2px; background:linear-gradient(90deg,transparent,var(--rc),transparent); opacity:.7; pointer-events:none; }
  .fg-dash.shake{ animation:fgShake .45s; }
  @keyframes fgShake{ 0%,100%{ transform:translateX(0);} 20%{ transform:translateX(-7px);} 40%{ transform:translateX(6px);} 60%{ transform:translateX(-4px);} 80%{ transform:translateX(3px);} }
  .fg-hero{ display:flex; gap:12px; align-items:center; }
  .fg-hero-ic{ width:56px; height:56px; flex:none; display:grid; place-items:center; color:var(--rc); border-radius:13px;
    background:radial-gradient(70% 70% at 50% 40%, color-mix(in srgb,var(--rc) 22%,transparent), transparent); }
  .fg-hero-ic svg{ width:38px; height:38px; filter:drop-shadow(0 0 8px color-mix(in srgb,var(--rc) 60%,transparent)); }
  .fg-hero-t{ flex:1; min-width:0; }
  .fg-hero-n{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:13.5px; color:#f2f7ff; letter-spacing:.03em; }
  .fg-hero-badges{ display:flex; gap:6px; flex-wrap:wrap; margin-top:7px; }
  .fg-rar{ font-family:'Orbitron',sans-serif; font-size:8.5px; font-weight:800; letter-spacing:.12em; color:#08131c;
    background:linear-gradient(180deg, color-mix(in srgb,var(--rc) 80%,#fff), var(--rc)); border-radius:7px; padding:3px 8px; }
  .fg-b{ font-size:9.5px; font-weight:800; letter-spacing:.05em; color:#c9d8e8; border:1px solid #2b4055; border-radius:7px; padding:3px 7px; font-variant-numeric:tabular-nums; }
  .fg-b b{ color:#ffab4a; } .fg-b i{ font-style:normal; color:#71859a; }
  .fg-b.pris{ border-color:rgba(125,243,255,.6); } .fg-b.pris b{ color:#7df3ff; }
  .fg-b.tar{ border-color:rgba(255,90,104,.55); color:#ffb9bf; } .fg-b.tar b{ color:#ff6b78; }
  .fg-b.cryo{ border-color:rgba(174,230,255,.6); color:#cdeeff; } .fg-b.cryo b{ color:#aee6ff; }
  .fg-stats{ display:flex; gap:7px; flex-wrap:wrap; margin-top:11px; }
  .fg-stat{ font-size:10.5px; font-weight:700; color:#9fb1c4; border:1px solid #223245; border-radius:9px; padding:5px 9px; background:rgba(255,255,255,.02); }
  .fg-stat span{ margin-right:5px; color:#7f92a6; }
  .fg-stat b{ color:#e7f0fb; font-variant-numeric:tabular-nums; }
  .fg-stat i{ font-style:normal; color:#7ce0a0; font-size:10px; }

  .fg-grid{ display:grid; grid-template-columns:repeat(auto-fit,minmax(250px,1fr)); gap:10px; margin-top:12px; }
  .fg-panel{ border:1px solid #3a2a17; border-radius:14px; padding:12px; position:relative; background:linear-gradient(180deg,#160f08,#0d0906); transition:border-color .2s, box-shadow .2s; }
  #fg-purity{ border-color:#2a1f3a; background:linear-gradient(180deg,#130e1c,#0b0812); }
  .fg-panel.charging{ animation:fgCharge .4s ease-in-out; }
  @keyframes fgCharge{ 0%,100%{ box-shadow:none;} 50%{ box-shadow:0 0 26px -4px #ffab4a; } }
  .fg-panel.flash-ok{ border-color:#7ce0a0; box-shadow:0 0 22px -4px rgba(124,224,160,.9); }
  .fg-panel.flash-no{ border-color:#ff5a68; box-shadow:0 0 22px -4px rgba(255,90,104,.9); }
  .fg-flash{ position:absolute; left:50%; top:8px; transform:translateX(-50%); pointer-events:none; z-index:3; white-space:nowrap;
    font-family:'Orbitron',sans-serif; font-weight:900; font-size:10.5px; letter-spacing:.1em; padding:5px 12px; border-radius:9px;
    animation:fgFlashIn .25s cubic-bezier(.18,1.4,.4,1), fgFlashOut .3s 1s forwards; }
  .fg-flash.ok{ color:#08131c; background:linear-gradient(180deg,#9df0bb,#5fd68b); box-shadow:0 4px 16px -4px rgba(124,224,160,.9); }
  .fg-flash.no{ color:#fff; background:linear-gradient(180deg,#ff6b78,#e0374a); box-shadow:0 4px 16px -4px rgba(255,90,104,.9); }
  @keyframes fgFlashIn{ 0%{ transform:translateX(-50%) scale(.5); opacity:0;} 100%{ transform:translateX(-50%) scale(1); opacity:1;} }
  @keyframes fgFlashOut{ to{ opacity:0; transform:translateX(-50%) translateY(-6px); } }
  .fg-panel-h{ font-family:'Orbitron',sans-serif; font-weight:800; font-size:10px; letter-spacing:.16em; color:#ffab4a; }
  #fg-purity .fg-panel-h{ color:#c07bff; }
  .fg-pips{ display:flex; gap:4px; margin-top:9px; }
  .fg-pips i{ flex:1; height:5px; border-radius:3px; background:#1d1610; }
  .fg-pips i.on{ background:#ffab4a; box-shadow:0 0 6px rgba(255,171,74,.6); }
  .fg-pips i.risk{ background:#241016; }
  .fg-pips i.risk.on{ background:#ff7a4a; box-shadow:0 0 6px rgba(255,122,74,.7); }
  .fg-chance{ display:flex; align-items:center; gap:7px; flex-wrap:wrap; margin-top:10px; }
  .fg-chance span{ font-size:8px; font-weight:800; letter-spacing:.12em; color:#7f92a6; }
  .fg-chance b{ font-family:'Orbitron',sans-serif; font-size:13px; font-variant-numeric:tabular-nums; }
  .fg-chance.hi b{ color:#7ce0a0; } .fg-chance.mid b{ color:#ffd24d; } .fg-chance.lo b{ color:#ff6b78; }
  .fg-heat{ font-style:normal; font-size:9px; font-weight:800; color:#ffab4a; letter-spacing:.05em; }
  .fg-chbar{ flex-basis:100%; height:5px; border-radius:3px; background:#17110b; overflow:hidden; }
  .fg-chbar i{ display:block; height:100%; border-radius:3px; }
  .fg-chance.hi .fg-chbar i{ background:#7ce0a0; } .fg-chance.mid .fg-chbar i{ background:#ffd24d; } .fg-chance.lo .fg-chbar i{ background:#ff6b78; }
  .fg-next{ margin-top:8px; font-size:10.5px; font-weight:700; color:#9fb1c4; }
  .fg-next b{ color:#ffd9ae; }
  #fg-purity .fg-next b{ color:#d9b8ff; }
  .fg-cost{ display:flex; gap:10px; margin-top:8px; font-size:11px; font-weight:700; font-variant-numeric:tabular-nums; }
  .fg-btn{ width:100%; margin-top:9px; border:none; border-radius:10px; padding:11px; cursor:pointer;
    font-family:'Orbitron',sans-serif; font-weight:800; font-size:12px; letter-spacing:.14em; color:#1a0d04;
    background:linear-gradient(180deg,#ffcf8a,#ffab4a); box-shadow:0 6px 18px -8px #ffab4a; transition:transform .08s; }
  .fg-btn.pur{ color:#160a24; background:linear-gradient(180deg,#dcb8ff,#c07bff); box-shadow:0 6px 18px -8px #c07bff; }
  .fg-btn:active{ transform:scale(.97); }
  .fg-btn:disabled{ opacity:.38; cursor:default; }
  .fg-note{ margin-top:6px; text-align:center; font-size:8.5px; color:#66798d; letter-spacing:.04em; line-height:1.5; }
  .fg-short{ margin-top:7px; text-align:center; font-size:10px; font-weight:700; color:#9fb1c4; border:1px dashed #3a2a17; border-radius:9px; padding:6px 8px; line-height:1.5; }
  .fg-short b{ color:#ffd9ae; }
  .fg-nobase{ margin-top:10px; font-size:10.5px; color:#8ba0b5; line-height:1.55; border:1px dashed #2b4055; border-radius:9px; padding:9px 10px; }
  .fg-maxed{ margin-top:10px; text-align:center; font-family:'Orbitron',sans-serif; font-size:10px; font-weight:800; letter-spacing:.1em; color:#ffab4a; padding:9px; border:1px solid rgba(255,171,74,.55); border-radius:10px; }
  .fg-cryo{ display:block; margin-top:6px; font-size:9px; letter-spacing:.12em; color:#aee6ff; }
  .fg-pur{ margin-top:10px; text-align:center; }
  .fg-pur b{ font-family:'Orbitron',sans-serif; font-size:26px; font-weight:900; color:#d9b8ff; }
  .fg-pur.pris b{ color:#7df3ff; text-shadow:0 0 18px rgba(125,243,255,.6); }
  .fg-pur span{ display:block; font-size:8.5px; font-weight:800; letter-spacing:.14em; color:#7f92a6; text-transform:uppercase; margin-top:2px; }
  .fg-purbar{ position:relative; height:8px; border-radius:5px; margin-top:10px; background:linear-gradient(90deg,#3a2a4a,#c07bff 70%,#7df3ff); overflow:visible; }
  .fg-purbar b{ position:absolute; top:50%; width:4px; height:16px; border-radius:2px; background:#fff; transform:translate(-50%,-50%); box-shadow:0 0 8px rgba(255,255,255,.8); }
  .fg-pfloor{ position:absolute; top:-3px; bottom:-3px; width:2px; background:rgba(255,255,255,.35); }
  .fg-ppris{ position:absolute; top:-3px; bottom:-3px; left:${((125 - 60) / 70 * 100).toFixed(1)}%; width:2px; background:#7df3ff; }

  #fg-overlay{ position:absolute; inset:0; z-index:14; display:none; align-items:center; justify-content:center; padding:18px;
    background:rgba(6,10,17,.85); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px); }
  #fg-overlay.show{ display:flex; }
  .fg-cine{ text-align:center; position:relative; max-width:320px; }
  .fg-cine-rings i{ position:absolute; left:50%; top:44px; width:20px; height:20px; border-radius:50%; border:2px solid var(--tc);
    transform:translate(-50%,-50%); opacity:0; animation:fgRing 1.4s ease-out infinite; }
  .fg-cine-rings i:nth-child(2){ animation-delay:.45s; } .fg-cine-rings i:nth-child(3){ animation-delay:.9s; }
  @keyframes fgRing{ 0%{ transform:translate(-50%,-50%) scale(1); opacity:.8;} 100%{ transform:translate(-50%,-50%) scale(9); opacity:0;} }
  .fg-cine-ic{ display:inline-grid; place-items:center; width:88px; height:88px; color:var(--tc); }
  .fg-cine-ic svg{ width:64px; height:64px; filter:drop-shadow(0 0 22px var(--tc)); animation:fgPop .5s cubic-bezier(.18,1.4,.4,1); }
  .fg-cine-k{ font-family:'Orbitron',sans-serif; font-size:9.5px; font-weight:800; letter-spacing:.22em; color:#9db6cb; margin-top:8px; }
  .fg-cine-big{ font-family:'Orbitron',sans-serif; font-size:22px; font-weight:900; letter-spacing:.1em; color:var(--tc); text-shadow:0 0 28px var(--tc); margin-top:6px; animation:fgPop .5s .2s cubic-bezier(.18,1.4,.4,1) backwards; }
  @keyframes fgPop{ 0%{ transform:scale(.4); opacity:0;} 100%{ transform:scale(1); opacity:1;} }
  .fg-cine-n{ font-size:11px; font-weight:700; color:#8ba0b5; margin-top:6px; letter-spacing:.06em; }
  .fg-cine-btn{ margin-top:18px; border:none; border-radius:11px; padding:12px 28px; cursor:pointer; font-family:'Rajdhani',sans-serif; font-weight:800; font-size:14px; letter-spacing:.06em;
    color:#08111a; background:linear-gradient(180deg,#e8f2fb,#b9cee0); transition:transform .08s; }
  .fg-cine-btn:active{ transform:scale(.97); }

  @media (prefers-reduced-motion: reduce){
    .fg-dash.shake,.fg-panel.charging,.fg-flash,.fg-cine-rings i,.fg-cine-ic svg,.fg-cine-big{ animation:none !important; }
  }
  `;
})();
