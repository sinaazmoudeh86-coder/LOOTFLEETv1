/* =============================================================================
   starforge.js — STARFORGE (Command ▸ Starforge) — HARDPOINT ENHANCEMENT
   -----------------------------------------------------------------------------
   SLOT-BASED (Jul 2026). Temper and purity live on the HARDPOINT, not on the
   fitting docked in it: the work you hammer into a slot stays there when the
   fitting changes. Find a better gun, dock it, and it inherits the barrel's
   temper instantly — losing gear no longer means losing the forge.

     • TEMPER (+0 → +15) per hardpoint: every strike costs Gold + Iron and rolls
       a published success chance — gentle to +5, then a steep geometric collapse
       (60% at +5 down to ~12% at +15). Each level adds +6% to the docked
       fitting's combat stats (damage, hull, fire rate, crit damage, thrust).
       - FORGE HEAT (pity): every failure adds +3% success to the NEXT strike on
         that hardpoint (cap +45%). Success resets the heat.
       - SLIP RISK: above +10, a failed strike has a 40% chance to knock the
         temper down one level — but never below the +10 checkpoint.
     • AT +15: the hardpoint is cryo-hardened — +1% chance on hit to flash-freeze
       the target solid (FrostyFrost tech). Stacks across every +15 hardpoint
       with a fitting docked; bosses are immune. Surfaces as stats.cryoChance.
     • PURITY (60–130%) per hardpoint: latent forge purity multiplies the whole
       temper bonus. Rerolling costs Plasma and REPLACES the old roll — pure
       gamble — but the minimum possible roll creeps up +1% per reroll (to 95%).
       125%+ = PRISTINE.
     • PRICING is per-PILOT, never per-fitting: level + deepest zone reached +
       the temper level being climbed to, ×2.5 because the work is permanent.
       Keying it to the docked item's rarity would just mean forging with a
       common fitting in the slot and swapping the Primordial in for free.

   The forge lives on the account (state.forge, keyed by slot) and is applied at
   stat-computation time in game-v93's computeStats — item stats are never
   mutated, so an item's own worth is always its own numbers.
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
  const SLOT_ORDER = ['bow', 'bow2', 'arrows', 'arrows2', 'armor', 'boots', 'gloves', 'amulet'];
  function bank(res) { const st = G().state; return res === 'gold' ? (st.gold || 0) : ((st.resources || {})[res] || 0); }

  // ---- HARDPOINT forge state -------------------------------------------------
  function forge() {
    const st = G().state;
    if (!st.forge) st.forge = {};
    if (!st.forge.v) migrate(st);
    return st.forge;
  }
  function fs(slot) {
    const f = forge();
    if (!f[slot]) f[slot] = { lv: 0, heat: 0, pur: 100, rr: 0 };
    return f[slot];
  }
  // THE HULL DECIDES WHICH HARDPOINTS EXIST — not state.equipped. This listed
  // every key present in the equipped map, and that map keeps keys from hulls you
  // flew before, so a Dreadnought (no fighterCapacity, therefore no bays) grew a
  // Fighter Bay hardpoint to temper. CONFIG.shipSlots() is the same layout the
  // Hero screen and computeStats read, so the forge can no longer disagree with
  // them; a temper already paid for on a hidden slot waits there for the hull
  // that has it (state.forge is keyed by slot and is never pruned).
  function slotKeys() {
    const st = G().state, eq = st.equipped || {};
    let live = [];
    try { live = C().shipSlots(st.ship) || []; } catch (e) { live = []; }
    if (!live.length) {
      live = SLOT_ORDER.filter((k) => k in eq);
      Object.keys(eq).forEach((k) => { if (live.indexOf(k) === -1) live.push(k); });
    }
    return live.slice();
  }
  function mult(e) { return 1 + (PCT_PER_LV / 100) * e.lv * (e.pur / 100); }
  // PUBLIC — computeStats multiplies the docked fitting's boostable lines by this
  function slotMult(slot) { try { return mult(fs(slot)); } catch (e) { return 1; } }
  function slotTemper(slot) { try { const e = fs(slot); return { lv: e.lv | 0, pur: e.pur | 0 }; } catch (x) { return { lv: 0, pur: 100 }; } }
  const boosts = (k) => BOOST.indexOf(k) !== -1;

  // ---- ONE-TIME MIGRATION — item tempers → hardpoints ------------------------
  // Pre-slot saves baked the bonus into it.stats and recorded it in it.enh. Every
  // hardpoint inherits the BEST temper ever rolled for a fitting of its kind, so
  // nobody loses an investment, and every item is restored to its base stats.
  function migrate(st) {
    st.forge = st.forge || {};
    const best = {};
    const consider = (slot, e) => {
      if (!slot || !e) return;
      const cur = best[slot], lv = e.lv | 0, pur = (e.pur | 0) || 100;
      if (!cur || lv > cur.lv || (lv === cur.lv && pur > cur.pur)) best[slot] = { lv, heat: 0, pur, rr: e.rr | 0 };
    };
    const strip = (it) => {
      if (!it || !it.enh) return;
      const e = it.enh;
      for (const k in (e.base || {})) it.stats[k] = e.base[k];
      if (e.n0) it.name = e.n0;
      delete it.enh;
    };
    try {
      const eq = st.equipped || {};
      Object.keys(eq).forEach((k) => { const it = eq[k]; if (it && it.enh) { consider(k, it.enh); strip(it); } });
      (st.inventory || []).forEach((it) => {
        if (!it || !it.enh) return;
        // bag gear seeds every hardpoint of its family (either barrel, either magazine)
        Object.keys(eq).forEach((k) => { if (baseSlot(k) === it.slot) consider(k, it.enh); });
        strip(it);
      });
      const fits = st.fittings || {};
      Object.keys(fits).forEach((sh) => Object.keys(fits[sh] || {}).forEach((k) => strip(fits[sh][k])));
    } catch (e) {}
    Object.keys(best).forEach((k) => { if (!st.forge[k]) st.forge[k] = best[k]; });
    st.forge.v = 2;
    try { G().refreshStats(); G().save(); } catch (e) {}
  }

  // ODDS: gentle to +5, then a steep geometric collapse — each strike past +5 is
  // ~16% harder than the last (60% → 12% at +15). Heat pity is the counterweight.
  function chance(e) {
    const base = e.lv < 5 ? [100, 95, 90, 85, 80][e.lv] : Math.max(8, 60 * Math.pow(0.84, e.lv - 5));
    return clamp(Math.round(base + e.heat), 5, 100);
  }
  // ---- PRICING ---------------------------------------------------------------
  // FIXED COSTS, PER PILOT — never a share of your balance and never a function
  // of the fitting docked in the slot (that would be free to game: forge with a
  // common in the barrel, then dock the Primordial). A strike's price is your
  // PILOT LEVEL, the deepest ZONE you've reached, and the temper level it's
  // climbing to — ×2.5 because a hardpoint's work is permanent.
  const COST_CAP = 1e295;
  const fin = (n, alt) => (Number.isFinite(n) && n > 0 ? Math.min(n, COST_CAP) : (alt || 1));
  const plv = () => Math.max(1, G().state.level | 0);
  const zref = () => {
    const st = G().state;
    return Math.max(1, Math.min(1000, Math.max(st.highestDungeonReached | 0, st.highestUnlocked | 0, st.currentDungeon | 0, 1)));
  };
  // PILOT LEVEL — a flat difficulty ramp across the whole game (×1 → ×1.5 at 500)
  const lvlF = () => 1 + plv() / 1000;
  // gold economy is geometric in ZONE — anchor to what one kill pays there
  function econGold() { try { return fin(C().enemyGold(zref()), 1000); } catch (e) { return 1000; } }
  // iron/plasma economies are polynomial, not geometric — priced separately
  function econRes() { return fin(Math.pow(1 + zref(), 1.6), 1); }
  const PERMA = 2.5;   // permanence premium
  const floorAt = (v, fl) => Math.max(fl, Math.floor(fin(v, fl)));
  // costs are computed ONCE per render and reused on click, so the price shown
  // is exactly the price charged
  let _cCache = {};
  function costT(slot) {
    const e = fs(slot), k = slot + '|t|' + e.lv;
    if (_cCache[k]) return _cCache[k];
    const step = Math.pow(1.25, e.lv), m = PERMA * lvlF();
    return (_cCache[k] = {
      gold: floorAt(econGold() * 40 * m * step, 1000),      // ≈ 100 kills at your depth
      iron: floorAt(250 * econRes() * m * step, 100),
    });
  }
  function costR(slot) {
    const e = fs(slot), k = slot + '|r|' + e.rr;
    if (_cCache[k]) return _cCache[k];
    return (_cCache[k] = { plasma: floorAt(150 * econRes() * PERMA * lvlF() * Math.pow(1.25, e.rr), 200) });
  }
  // "you need X more ● — about N kills in Zone Z" — makes the gate legible
  function shortfall(c) {
    const need = [];
    const gGap = c.gold - bank('gold'), iGap = (c.iron || 0) - bank('iron');
    if (gGap > 0) need.push('<span style="color:#f2b24b">● ' + fmt(gGap) + '</span>');
    if (iGap > 0) need.push('<span style="color:#d0a060">◆ ' + fmt(iGap) + '</span>');
    if (!need.length) return '';
    const z = zref();
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
  // HARDPOINTS COUNT UP (build 710). Every secondary slot printed a flat ' II', so
  // a seven-cannon hull read "Cannon, Cannon II, Cannon II, Cannon II…" and there
  // was no way to tell which mount you were tempering. The slot key already IS the
  // ordinal — bow/bow2…bow7, arrows/arrows2…, armor/armor2… — so number from it.
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
  function slotOrdinal(k) { const m = /(\d+)$/.exec(k); return m ? Math.max(1, parseInt(m[1], 10)) : 1; }
  function slotName(k) {
    const sl = C().SLOTS[baseSlot(k)] || {};
    const n = slotOrdinal(k);
    return (sl.name || k) + (n > 1 ? ' ' + (ROMAN[n - 1] || n) : '');
  }
  function fmtStat(k, v) { const def = C().STATS[k] || {}; return def.fmt === 'flat' ? fmt(v) : (Math.round(v * 10) / 10) + '%'; }

  const UNLOCK_LV = 100;
  let _retry = 0;
  function render() {
    _cCache = {};   // reprice once per paint; the click then charges exactly what was shown
    boot();         // styles may not be in yet if the tab is opened before boot fired
    const body = $('forge-body');
    // the screen can be asked for before its markup is parsed (deep link, restored
    // tab, slow shell) — retry a few frames instead of leaving an empty panel
    if (!body) { if (_retry++ < 20) requestAnimationFrame(render); return; }
    _retry = 0;
    const st = G().state;
    // gated at Lv 100 — the lock veil (game.html #lock-forge) explains the system
    // while you climb, so leave the body empty rather than teasing a live panel
    if ((st.level | 0) < UNLOCK_LV) { body.innerHTML = ''; const s0 = $('forge-sub'); if (s0) s0.textContent = 'Lv ' + UNLOCK_LV; return; }
    const keys = slotKeys();
    if (!keys.length) { body.innerHTML = '<div class="fg-empty">No hardpoints found on this hull.</div>'; return; }
    const tempered = keys.filter((k) => fs(k).lv > 0).length;
    const sub = $('forge-sub'); if (sub) sub.textContent = tempered ? tempered + '/' + keys.length + ' hardpoints tempered' : keys.length + ' hardpoints';
    if (!sel || keys.indexOf(sel) === -1) sel = keys.find((k) => st.equipped[k]) || keys[0];
    body.innerHTML =
      '<div class="fg-intro">The forge works on <b>hardpoints, not fittings</b> — temper a slot once and <b>every fitting you ever dock in it</b> inherits the work. Each temper level adds <b>+6% combat stats</b> to whatever sits in the slot; odds fall as the temper climbs. Failures build <b>Forge Heat</b> (+3% next strike). Past <b>+10</b> a miss can <b>slip a level</b>. Reroll <b>Purity</b> (60–130%) with plasma to multiply the whole temper. Costs are <b>fixed</b> — set by your <b>pilot level</b> and <b>deepest zone</b>, never by the fitting docked. Every hardpoint at <b>+15</b> adds <b style="color:#aee6ff">❄ 1% flash-freeze</b> on hit (bosses immune) — they stack.</div>' +
      '<div class="fg-strip">' + keys.map(chip).join('') + '</div>' +
      dash(sel);
    wire(body);
  }

  function chip(k) {
    const it = G().state.equipped[k];
    const r = it ? (C().RARITY[it.rarity] || C().RARITY[0]) : { color: '#42566d' };
    const e = fs(k);
    return '<button class="fg-chip' + (k === sel ? ' on' : '') + (it ? '' : ' bare') + '" data-sel="' + k + '" style="--rc:' + r.color + '">' +
      '<span class="fg-chip-ic">' + (it ? (it.icon || '') : '⬡') + '</span>' +
      '<span class="fg-chip-n">' + slotName(k) + '</span>' +
      '<span class="fg-chip-s">' + (e.lv ? '<b>+' + e.lv + '</b>' : 'BASE') + (it ? '' : ' · EMPTY') + '</span>' +
    '</button>';
  }

  function dash(k) {
    const st = G().state, it = st.equipped[k], e = fs(k);
    const r = it ? (C().RARITY[it.rarity] || C().RARITY[0]) : { color: '#42566d', name: 'empty' };
    const m = mult(e);
    const statRows = it ? BOOST.filter((sk) => it.stats && it.stats[sk] != null).map((sk) => {
      const def = C().STATS[sk] || { name: sk };
      const bonus = it.stats[sk] * (m - 1);
      return '<div class="fg-stat"><span>' + def.name + '</span><b>' + fmtStat(sk, it.stats[sk]) + (bonus > 0.01 ? ' <i>+' + fmtStat(sk, bonus) + '</i>' : '') + '</b></div>';
    }).join('') : '';
    return '<div class="fg-dash" id="fg-dash" style="--rc:' + r.color + '" data-comment-anchor="fg-dash">' +
      '<div class="fg-hero">' +
        '<span class="fg-hero-ic">' + (it ? (it.icon || '') : '⬡') + '</span>' +
        '<div class="fg-hero-t">' +
          '<div class="fg-hero-n">' + slotName(k) + (e.lv ? ' <b style="color:#ffab4a">+' + e.lv + '</b>' : '') + '</div>' +
          '<div class="fg-hero-sub">' + (it ? 'docked · <b>' + it.name + '</b>' : 'no fitting docked — the temper waits here') + '</div>' +
          '<div class="fg-hero-badges">' +
            (it ? '<span class="fg-rar">' + (r.name || '').toUpperCase() + '</span>' : '') +
            '<span class="fg-b">TEMPER <b>+' + e.lv + '</b><i>/' + MAX_LV + '</i></span>' +
            (e.lv >= MAX_LV ? '<span class="fg-b cryo">❄ FREEZE <b>1%</b></span>' : '') +
            (it ? '<span class="fg-b">ILVL <b>' + (it.ilvl | 0) + '</b></span>' : '') +
            '<span class="fg-b' + (e.pur >= PRISTINE ? ' pris' : '') + '">PURITY <b>' + e.pur + '%</b></span>' +
            '<span class="fg-b">TOTAL <b>+' + Math.round((m - 1) * 100) + '%</b></span>' +
          '</div>' +
        '</div>' +
      '</div>' +
      (statRows ? '<div class="fg-stats">' + statRows + '</div>' : '') +
      '<div class="fg-grid">' + temperPanel(k, e) + purityPanel(k, e) + '</div>' +
    '</div>';
  }

  function temperPanel(k, e) {
    const maxed = e.lv >= MAX_LV, ch = chance(e), c = costT(k);
    const afford = bank('gold') >= c.gold && bank('iron') >= c.iron;
    const chCls = ch >= 75 ? 'hi' : ch >= 40 ? 'mid' : 'lo';
    const pips = Array.from({ length: MAX_LV }, (_, i) => '<i class="' + (i < e.lv ? 'on' : '') + (i >= SLIP_FLOOR ? ' risk' : '') + '"></i>').join('');
    let inner;
    if (maxed) inner = '<div class="fg-maxed">✦ +15 — HARDPOINT TEMPERED TO THE LIMIT<span class="fg-cryo">❄ +1% FLASH-FREEZE ON HIT</span></div>';
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
      (afford ? '' : shortfall(c)) +
      '<div class="fg-note">' + (e.lv >= SLIP_FLOOR ? 'Above +10 a miss has a 40% chance to slip one level (never below +10)' : 'Fail costs only the materials — heat carries to your next strike') + ' · the work stays on the hardpoint through every gear swap</div>';
    return '<div class="fg-panel" id="fg-temper"><div class="fg-panel-h">⚒ TEMPER</div><div class="fg-pips">' + pips + '</div>' + inner + '</div>';
  }

  function purityPanel(k, e) {
    const c = costR(k), afford = bank('plasma') >= c.plasma;
    const fl = purFloor(e);
    const pos = clamp((e.pur - 60) / (130 - 60) * 100, 0, 100);
    const inner =
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
    const st = G().state, e = fs(k);
    if (e.lv >= MAX_LV) return;
    const c = costT(k);
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
    finish('fg-temper', () => {
      flashText('fg-temper', ok, ok ? (e.lv >= MAX_LV ? '★ MAX TEMPER +' + e.lv : 'SUCCESS · +' + e.lv) : slipped ? 'MISS · SLIPPED TO +' + e.lv : 'MISS · 🔥 HEAT +' + e.heat + '%');
      if (ok && e.lv >= MAX_LV) { try { G().bumpLife('temper15', 1); G().save(); } catch (x) {} }   // MASTER ARMOURER badge
      if (ok && e.lv >= MAX_LV) showCine(k, '⚒ +15 TEMPER', 'CRYO-HARDENED · +1% FLASH-FREEZE', '#ffab4a');
    });
  }

  function reroll(k) {
    if (busy) return;
    const st = G().state, e = fs(k);
    const c = costR(k);
    if (bank('plasma') < c.plasma) return;
    busy = true;
    st.resources = st.resources || { fuel: 0, iron: 0, plasma: 0 };
    st.resources.plasma -= c.plasma;
    const old = e.pur;
    e.rr++;
    const fl = purFloor(e);
    e.pur = Math.round(fl + Math.random() * (130 - fl));
    finish('fg-purity', () => {
      const up = e.pur >= old;
      flashText('fg-purity', up, old + '% → ' + e.pur + '%' + (e.pur >= PRISTINE ? ' ✦ PRISTINE' : ''));
      if (e.pur >= PRISTINE) { try { G().bumpLife('pristine', 1); G().save(); } catch (x) {} }      // PRISTINE FORGE badge
      if (e.pur >= PRISTINE) showCine(k, '✦ ' + e.pur + '% PURITY', 'PRISTINE FORGE', '#7df3ff');
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

  function showCine(k, big, kicker, color) {
    const it = G().state.equipped[k];
    let o = $('fg-overlay');
    if (!o) { o = document.createElement('div'); o.id = 'fg-overlay'; ($('screen-forge') || document.body).appendChild(o); }
    o.className = 'show';
    o.innerHTML = '<div class="fg-cine" style="--tc:' + color + '">' +
      '<div class="fg-cine-rings"><i></i><i></i><i></i></div>' +
      '<span class="fg-cine-ic">' + (it ? (it.icon || '') : '⬡') + '</span>' +
      '<div class="fg-cine-k">' + kicker + '</div>' +
      '<div class="fg-cine-big">' + big + '</div>' +
      '<div class="fg-cine-n">' + slotName(k) + (it ? ' · ' + it.name : '') + '</div>' +
      '<button class="fg-cine-btn">GLORIOUS</button></div>';
    o.querySelector('.fg-cine-btn').onclick = () => { o.classList.remove('show'); o.innerHTML = ''; render(); };
  }

  // ---- BOOT ------------------------------------------------------------------
  // CSS is a `const` declared at the BOTTOM of this file, so boot() must never run
  // during the module body — it would hit the temporal dead zone, throw, and abort
  // the script before window.STARFORGE is assigned (forge tab then paints nothing).
  // The boot call therefore lives at the very end of the file, past the CSS literal.
  function boot() { if (!$('fg-css')) { const s = document.createElement('style'); s.id = 'fg-css'; s.textContent = CSS; document.head.appendChild(s); } }

  window.STARFORGE = { render, slotMult, slotTemper, boosts, MAX_LV };

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
  .fg-hero-sub{ font-size:11px; color:#9fb1c4; margin-top:3px; }
  .fg-hero-sub b{ color:#dbe8f5; }
  .fg-chip.bare{ opacity:.72; }
  .fg-chip.bare .fg-chip-ic{ font-size:18px; color:#42566d; }
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

  // ---- BOOT (must stay last — see note by boot()) -----------------------------
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
