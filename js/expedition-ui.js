/* =============================================================================
   expedition-ui.js — FLEET EXPLORATION · the screen
   ---------------------------------------------------------------------------
   Four surfaces, in the order the loop needs them:
     ACTIVE      what is out there right now, and what came home
     BOARD       six missions, rotating every four hours
     HANGAR      every hull's survey profile, rank and repair state
   plus two sheets: FLEET ASSIGNMENT (the real decision) and DEBRIEF (the payoff).

   The assignment sheet is the whole feature. It recomputes the rating, the
   estimate, the fuel bill and the overkill warning on every tap, so the player
   is never guessing what a ship is worth to a mission.
============================================================================= */
(function () {
  'use strict';
  const G = () => window.GAME;
  const X = () => window.EXPO;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => window.EXPO.esc(s);
  const fmt = (n) => window.EXPO.fmt(n);
  const stars = (n) => '★'.repeat(n) + '<i>' + '★'.repeat(5 - n) + '</i>';
  function dur(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    if (h >= 1) return h + 'h ' + (m < 10 ? '0' : '') + m + 'm';
    return m + 'm ' + (s % 60 < 10 ? '0' : '') + (s % 60) + 's';
  }
  function hrs(h) { return (h % 1 === 0 ? h : h.toFixed(1)) + 'h'; }
  function clock(ms) {
    try { return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; }
  }
  function sheet(html) { try { return window.SOCIAL.sheet(html); } catch (e) { return null; } }
  function closeSheet() { const s = $('sc-sheet'); if (s) s.remove(); }
  function toast(m) { try { window.UI.unlockToast(m); } catch (e) {} }
  function shipImg(k, cls) {
    return '<img class="' + cls + '" src="ships/ship-' + k + '.png" alt="" decoding="async" onerror="this.style.visibility=\'hidden\'">';
  }
  // EVERY CHIP NAMES WHAT IT PAYS (build 710). The manifest was six glyph-and-number
  // chips in six colours — two of them blue (⬢ fuel and ◇ Dread Cores) — so
  // "what are the blue rewards?" was a question the screen could not answer.
  const RW = [
    ['gold',   'rw-g', '$', 'Gold'],
    ['fuel',   'rw-f', '⬢', 'Fuel'],
    ['iron',   'rw-i', '◆', 'Iron'],
    ['plasma', 'rw-p', '✦', 'Plasma'],
    ['cores',  'rw-c', '◇', 'Dread Cores'],
    ['lc',     'rw-l', '◈', 'LootCoins'],
  ];
  function rewardChips(p, opts) {
    const o = opts || {};
    const b = RW.filter((r) => p[r[0]]).map((r) => '<em class="' + r[1] + '">' + r[2] + ' ' + fmt(p[r[0]]) + '<u>' + r[3] + '</u></em>');
    if (!b.length) b.push('<em class="rw-n">nothing recoverable</em>');
    return '<div class="ex-rw' + (o.big ? ' big' : '') + '">' + b.join('') + '</div>';
  }


  // ===========================================================================
  // SCREEN
  // ===========================================================================
  let _timer = null;
  function render() {
    const body = $('expo-body'); if (!body || !X()) return;
    X().tick();
    if (!X().unlocked()) { body.innerHTML = locked(); stopTicker(); return; }
    body.innerHTML = activeSection() + boardSection() + hangarSection();
    head();
    startTicker();
  }
  function locked() {
    return '<div class="ex-empty"><div class="ex-empty-ic">◎</div><h3>Fleet Exploration</h3>'
      + '<p>Unlocks at <b>Level ' + X().GATE_LV + '</b>. Idle hulls in your hangar can be sent out to survey the rim while you fly — they return hours later with cargo, scars and experience.</p></div>';
  }
  function head() {
    const sub = $('expo-sub'); if (!sub) return;
    const act = X().active().length, sl = X().slots(), rd = X().ready().length;
    sub.innerHTML = '<b>' + act + '/' + sl + '</b> out' + (rd ? ' · <b style="color:#6fe0a0">' + rd + ' returned</b>' : '')
      + ' · board rotates ' + dur(X().windowEnds() - (window.SERVERTIME ? SERVERTIME.now() : Date.now()));
  }

  // ---- ACTIVE ---------------------------------------------------------------
  function activeSection() {
    const act = X().active(), sl = X().slots(), nx = X().nextSlot();
    let h = '<div class="ex-sec"><div class="ex-sec-h"><span class="ex-sec-t">◈ EXPEDITIONS UNDERWAY</span>'
      + '<span class="ex-sec-n">' + act.length + ' / ' + sl + ' berths'
      + (nx ? ' · +1 at Lv ' + nx.lv : '') + '</span></div>';
    if (!act.length) {
      h += '<div class="ex-idle">No fleets out. Pick a mission below — your flagship stays with you, everything else in the hangar can fly.</div>';
    } else {
      h += '<div class="ex-list">' + act.map(activeCard).join('') + '</div>';
    }
    return h + '</div>';
  }
  function activeCard(a) {
    const back = X().returned(a), p = X().progress(a);
    const rev = X().revealed(a);
    const last = rev.length ? rev[rev.length - 1] : null;
    const left = Math.max(0, a.t1 - (window.SERVERTIME ? SERVERTIME.now() : Date.now()));
    return '<div class="ex-act' + (back ? ' back' : '') + '" data-exp="' + a.id + '">'
      + '<div class="ex-act-top">'
        + '<span class="ex-ic">' + a.ic + '</span>'
        + '<div class="ex-act-id"><div class="ex-act-n">' + esc(a.name) + '</div>'
        + '<div class="ex-act-s">' + esc(a.place) + ' · <span class="ex-st">' + stars(a.stars) + '</span> · rating ' + fmt(a.rating) + ' / ' + a.req + '</div></div>'
        + '<div class="ex-act-fleet">' + a.ships.map((k) => shipImg(k, 'ex-fs')).join('') + '</div>'
      + '</div>'
      + '<div class="ex-bar' + (back ? ' full' : '') + '"><i style="width:' + (p * 100).toFixed(1) + '%"></i>'
        + (a.ev || []).map((x) => '<u class="' + (x.at <= p ? 'on' : '') + '" style="left:' + (x.at * 100).toFixed(1) + '%"></u>').join('')
      + '</div>'
      + '<div class="ex-act-foot">'
        + (back
          ? '<span class="ex-back">◎ RETURNED — awaiting debrief</span><button class="ex-btn go" data-debrief="' + a.id + '">DEBRIEF</button>'
          : '<span class="ex-eta">' + dur(left) + ' remaining <i>· lands ' + clock(a.t1) + '</i></span>'
            + '<button class="ex-btn ghost" data-recall="' + a.id + '">Recall</button>')
      + '</div>'
      + (last && !back ? '<div class="ex-live"><span>' + last.ic + '</span>' + esc(last.t) + '</div>' : '')
      + '</div>';
  }

  // ---- BOARD ----------------------------------------------------------------
  function boardSection() {
    const list = X().board(), full = X().active().length >= X().slots();
    let h = '<div class="ex-sec"><div class="ex-sec-h"><span class="ex-sec-t">◎ MISSION BOARD</span>'
      + '<span class="ex-sec-n">rotates in ' + dur(X().windowEnds() - (window.SERVERTIME ? SERVERTIME.now() : Date.now())) + '</span></div>';
    if (!list.length) {
      h += '<div class="ex-idle">Every mission on this board is out. New contracts post when the board rotates.</div>';
    } else {
      h += '<div class="ex-grid">' + list.map((m) => missionCard(m, full)).join('') + '</div>';
    }
    return h + '</div>';
  }
  function missionCard(m, full) {
    const t = X().TYPE_BY_K[m.t], tier = X().TIERS[m.stars - 1];
    const pay = X().payout(m);
    return '<button class="ex-m s' + m.stars + (full ? ' full' : '') + '" data-mission="' + m.id + '"' + (full ? ' disabled' : '') + '>'
      + '<div class="ex-m-h"><span class="ex-ic">' + t.ic + '</span>'
        + '<div><div class="ex-m-n">' + esc(t.n) + '</div><div class="ex-m-p">' + esc(m.place) + '</div></div>'
        + '<span class="ex-st">' + stars(m.stars) + '</span></div>'
      + '<div class="ex-m-line">' + esc(t.line) + '</div>'
      + '<div class="ex-m-stats">'
        + '<span><i>DURATION</i><b>' + hrs(m.hours) + '</b></span>'
        + '<span><i>REQUIRED</i><b>' + m.req + '</b></span>'
        + '<span><i>RISK</i><b>' + tier.risk + '</b></span>'
      + '</div>'
      + rewardChips(pay)
      + '<div class="ex-m-cta">' + (full ? 'ALL BERTHS FULL' : 'ASSIGN FLEET →') + '</div>'
      + '</button>';
  }

  // ---- HANGAR ---------------------------------------------------------------
  function hangarSection() {
    const av = X().available();
    let h = '<div class="ex-sec"><div class="ex-sec-h"><span class="ex-sec-t">⬡ HANGAR READINESS</span>'
      + '<span class="ex-sec-n">' + av.filter(X().canAssign).length + ' ready</span></div>';
    if (av.length <= 1) {
      h += '<div class="ex-idle">Your flagship never leaves your side — you need a <b>second hull</b> before you can send anything out. Buy one in <b>Ships</b>.</div>';
    }
    h += '<div class="ex-hang">' + av.map(hullRow).join('') + '</div>';
    return h + '</div>';
  }
  function hullRow(s) {
    const p = s.p, d = s.dmg;
    const st = s.flag ? '<span class="ex-tag flag">FLAGSHIP</span>'
      : s.busy ? '<span class="ex-tag out">ON EXPEDITION</span>'
      : s.wrecked ? '<span class="ex-tag bad">NEEDS REPAIR</span>'
      : s.escort ? '<span class="ex-tag esc">ESCORT</span>'
      : '<span class="ex-tag ok">READY</span>';
    const rep = d > 0
      ? '<div class="ex-h-dmg"><i style="width:' + Math.round(d * 100) + '%"></i><span>−' + Math.round(d * 100) + '% · self-repair ' + dur(X().repairLeft(s.key)) + '</span>'
        + '<button class="ex-fix" data-fix="' + s.key + '">FIX ◆' + fmt((X().repairCost(s.key) || {}).iron || 0) + '</button></div>'
      : '';
    return '<div class="ex-h' + (s.flag ? ' flag' : '') + (s.busy ? ' busy' : '') + '">'
      + shipImg(s.key, 'ex-h-art')
      + '<div class="ex-h-main">'
        + '<div class="ex-h-n">' + esc(s.name) + (s.rank ? '<em class="ex-rk">EXP ' + X().RANK_ROMAN[s.rank] + '</em>' : '')
          + (s.asc ? '<em class="ex-rk asc" title="Ship Ascension — +' + Math.round(s.asc * X().ASC_PER_STAR * 100) + '% survey profile">✦ ' + s.asc + '</em>' : '') + st + '</div>'
        + '<div class="ex-h-st">'
          + '<span title="Survey — sensors, labs, bays">◎ ' + Math.round(p.sv) + '</span>'
          + '<span title="Range — endurance and reach">◈ ' + Math.round(p.rg) + '</span>'
          + '<span title="Resolve — surviving complications">⛨ ' + Math.round(p.rs) + '</span>'
          + '<b>' + Math.round(p.tot * X().hullMult(s.key) * X().rankMult(s.key) * X().ascMult(s.key) * X().dmgMult(s.key)) + '</b>'
          + (s.runs ? '<u>' + s.runs + ' run' + (s.runs === 1 ? '' : 's') + '</u>' : '')
        + '</div>'
        + rep
      + '</div></div>';
  }

  // ===========================================================================
  // FLEET ASSIGNMENT SHEET
  // ===========================================================================
  let _pick = [];
  function openAssign(mid) {
    const m = X().missionById(mid); if (!m) return;
    if (X().active().length >= X().slots()) { toast('All expedition berths are full'); return; }
    _pick = [];
    const v = sheet(assignHtml(m));
    if (!v) return;
    redrawAssign(m);   // the live block ships empty — fill it before the first tap
    v.addEventListener('click', (e) => {
      const pk = e.target.closest && e.target.closest('[data-pick]');
      if (pk) {
        const k = pk.dataset.pick;
        const i = _pick.indexOf(k);
        if (i >= 0) _pick.splice(i, 1);
        else if (_pick.length >= X().MAX_SHIPS) { toast('Maximum ' + X().MAX_SHIPS + ' hulls per expedition'); return; }
        else _pick.push(k);
        redrawAssign(m);
        return;
      }
      if (e.target.closest && e.target.closest('[data-launch]')) doLaunch(m);
    });
  }
  function assignHtml(m) {
    const t = X().TYPE_BY_K[m.t];
    return '<div class="ex-sheet">'
      + '<div class="ex-sh-h"><span class="ex-ic big">' + t.ic + '</span>'
        + '<div><div class="ex-sh-n">' + esc(t.n) + '</div>'
        + '<div class="ex-sh-s">' + esc(m.place) + ' · <span class="ex-st">' + stars(m.stars) + '</span> · ' + hrs(m.hours) + '</div></div></div>'
      + '<div class="ex-sh-line">' + esc(t.line) + '</div>'
      + '<div class="ex-w">' + weightRow(t) + '</div>'
      + '<div id="ex-assign-live"></div>'
      + '</div>';
  }
  // What this mission actually asks of a hull — the reason "which ships" is a
  // decision and not just "the biggest ones".
  function weightRow(t) {
    const L = [['◎ SURVEY', t.w[0]], ['◈ RANGE', t.w[1]], ['⛨ RESOLVE', t.w[2]]];
    return L.map((x) => '<span class="ex-wc' + (x[1] >= 1.4 ? ' hi' : x[1] <= 0.7 ? ' lo' : '') + '">' + x[0] + ' <b>×' + x[1].toFixed(1) + '</b></span>').join('');
  }
  function redrawAssign(m) {
    const host = $('ex-assign-live'); if (!host) return;
    host.innerHTML = assignLive(m);
  }
  function assignLive(m) {
    const t = X().TYPE_BY_K[m.t];
    const av = X().available();
    const rating = X().fleetRating(_pick, t);
    const est = X().estimate(rating, m.req);
    const cost = X().fuelCost(m, _pick.length);
    // NEVER `| 0` A RESOURCE BALANCE. Bitwise OR coerces to a SIGNED 32-BIT int, so
    // any fuel total above 2,147,483,647 wraps to a large negative — an endgame
    // pilot with 2.4 billion fuel read as −1,924,456,846 here. Every launch then
    // failed the `cost > fuel` test below, the button locked to NOT ENOUGH FUEL,
    // and the feature was unusable for exactly the players with the most fuel.
    //
    // The model itself was never wrong: launch() compares `(res.fuel || 0) < cost`
    // with no coercion, so the fuel was really there and really spendable. This
    // was a display read that then gated the button.
    const fuel = Math.max(0, Number((G().state.resources || {}).fuel) || 0);
    const pay = _pick.length ? X().payout(m) : null;
    const over = est.ratio >= X().OVERKILL && _pick.length > 1;
    const short = cost > fuel;

    let h = '<div class="ex-picklist">' + av.map((s) => pickCard(s, t, m)).join('') + '</div>';

    h += formationBlock();

    h += '<div class="ex-verdict ' + est.k + '">'
      + '<div class="ex-v-row"><span>FLEET EXPLORATION RATING</span><b>' + fmt(rating) + '</b></div>'
      + '<div class="ex-v-row"><span>REQUIRED RATING</span><b>' + m.req + '</b></div>'
      + '<div class="ex-v-row big"><span>ESTIMATED OUTCOME</span><b style="color:' + est.c + '">' + est.t + '</b></div>'
      + '<div class="ex-v-bar"><i style="width:' + Math.min(100, est.ratio / 2 * 100).toFixed(1) + '%;background:' + est.c + '"></i><u style="left:50%"></u></div>'
      + '</div>';

    if (over) h += '<div class="ex-note warn">⚠ <b>Overcommitted.</b> This wing clears the requirement ' + est.ratio.toFixed(1) + '× over. It buys reliability and fewer complications — but these hulls are also your escorts, and they are grounded for ' + hrs(m.hours) + '.</div>';
    else if (est.ratio < 1 && _pick.length) h += '<div class="ex-note warn">⚠ Under the requirement. The fleet can still be sent, but expect a complication or a failed survey.</div>';

    const pulled = _pick.filter((k) => (G().state.fleet || []).indexOf(k) !== -1);
    if (pulled.length) h += '<div class="ex-note">These hulls fly as <b>escorts</b> right now. Launching pulls them out of your battle formation until they return.</div>';

    h += '<div class="ex-conf">'
      + '<div class="ex-c-row"><span>SELECTED</span><b>' + (_pick.length ? _pick.length + ' hull' + (_pick.length === 1 ? '' : 's') : '—') + '</b></div>'
      + '<div class="ex-c-row"><span>DURATION</span><b>' + hrs(m.hours) + '</b></div>'
      + '<div class="ex-c-row"><span>FUEL COST</span><b class="' + (short ? 'bad' : '') + '">⬢ ' + fmt(cost) + '<i> / ' + fmt(fuel) + '</i></b></div>'
      + '</div>'
      + (pay ? '<div class="ex-c-rw"><span>EXPECTED REWARDS <i>at full success</i></span>' + rewardChips(pay, { big: 1 }) + '</div>' : '')
      + '<div class="ex-sh-cta"><button class="ex-btn go wide" data-launch="1"' + (!_pick.length || short ? ' disabled' : '') + '>'
      + (!_pick.length ? 'SELECT AT LEAST ONE HULL' : short ? 'NOT ENOUGH FUEL' : 'LAUNCH EXPEDITION · ⬢ ' + fmt(cost)) + '</button></div>';
    return h;
  }
  // THE FORMATION YOU ARE FLYING RIGHT NOW (build 710). The sheet listed hulls you
  // could send and warned once a pick happened to be an escort, but never said
  // what the battle formation IS — so "which hulls can I spare" meant leaving the
  // screen. Flagship first (it can never go), then every escort, marked as it is
  // picked.
  function formationBlock() {
    const st = G().state, BY = (window.CONFIG || {}).SHIP_BY_KEY || {};
    const nm = (k) => esc((BY[k] || {}).name || k);
    const wing = (st.fleet || []).filter((k) => k);
    const pulled = wing.filter((k) => _pick.indexOf(k) !== -1).length;
    const chips = ['<span class="ex-fm-c flag">' + nm(st.ship) + '<i>FLAGSHIP · STAYS</i></span>']
      .concat(wing.map((k) => '<span class="ex-fm-c' + (_pick.indexOf(k) !== -1 ? ' out' : '') + '">' + nm(k)
        + '<i>' + (_pick.indexOf(k) !== -1 ? 'PULLED OUT' : 'ESCORT') + '</i></span>'));
    return '<div class="ex-fm"><div class="ex-fm-h"><span>⬡ YOUR FLEET RIGHT NOW</span><b>'
      + (wing.length ? (wing.length - pulled) + ' / ' + wing.length + ' escorts stay' : 'no escorts — flagship alone')
      + '</b></div><div class="ex-fm-l">' + chips.join('') + '</div></div>';
  }
  function pickCard(s, t, m) {
    const on = _pick.indexOf(s.key) !== -1;
    const can = X().canAssign(s);
    const c = Math.round(X().contribution(s.key, t));
    const why = s.flag ? 'FLAGSHIP — stays with you' : s.busy ? 'already on an expedition' : s.wrecked ? 'too damaged to fly' : '';
    return '<button class="ex-pk' + (on ? ' on' : '') + (can ? '' : ' off') + '"' + (can ? ' data-pick="' + s.key + '"' : ' disabled') + '>'
      + shipImg(s.key, 'ex-pk-art')
      + '<div class="ex-pk-m"><div class="ex-pk-n">' + esc(s.name) + (s.rank ? '<em class="ex-rk">' + X().RANK_ROMAN[s.rank] + '</em>' : '')
      + (s.asc ? '<em class="ex-rk asc">✦ ' + s.asc + '</em>' : '') + '</div>'
      + '<div class="ex-pk-s">' + (why || ('◎' + Math.round(s.p.sv) + '  ◈' + Math.round(s.p.rg) + '  ⛨' + Math.round(s.p.rs) + (s.dmg > 0 ? '  <u>−' + Math.round(s.dmg * 100) + '%</u>' : ''))) + '</div></div>'
      + '<div class="ex-pk-v">' + (can ? '<b>+' + fmt(c) + '</b><i>to this survey</i>' : '<span class="ex-pk-x">—</span>') + '</div>'
      + '</button>';
  }
  function doLaunch(m) {
    const r = X().launch(m.id, _pick);
    if (!r.ok) {
      const msg = { fuel: 'Not enough fuel', slots: 'All expedition berths are full', gone: 'That contract is no longer on the board',
        nofleet: 'Select at least one available hull', locked: 'Fleet Exploration is locked' }[r.reason] || 'Cannot launch';
      toast(msg); render(); return;
    }
    closeSheet();
    toast('◎ Expedition launched — ' + m.hours + 'h to ' + m.place);
    if (r.pulled && r.pulled.length) toast('⬡ ' + r.pulled.length + ' escort' + (r.pulled.length === 1 ? '' : 's') + ' pulled from your battle formation');
    render();
    try { window.UI.refreshAll(); } catch (e) {}
  }

  // ===========================================================================
  // DEBRIEF
  // ===========================================================================
  function openDebrief(id) {
    const a = X().byId(id); if (!a || a.done) return;
    const r = X().collect(id);
    if (!r.ok) { toast('Nothing to collect'); render(); return; }
    const ev = X().eventsOf(a);
    const o = a.out;
    const h = '<div class="ex-sheet debrief">'
      + '<div class="ex-db-k">MISSION DEBRIEF</div>'
      + '<div class="ex-db-t" style="color:' + o.c + '">' + o.t + '</div>'
      + '<div class="ex-db-s">' + a.ic + ' ' + esc(a.name) + ' · ' + esc(a.place) + ' · <span class="ex-st">' + stars(a.stars) + '</span></div>'
      + '<div class="ex-db-rate">Fleet rating <b>' + fmt(a.rating) + '</b> against a requirement of <b>' + a.req + '</b>'
        + (o.mult < 1 ? ' — recovered <b>' + Math.round(o.mult * 100) + '%</b> of the manifest' : ' — full manifest recovered') + '</div>'
      + rewardChips(r.paid, { big: 1 })
      + (ev.length ? '<div class="ex-db-h">LOG</div><div class="ex-db-ev">' + ev.map((x) =>
          '<div class="ex-ev g' + x.good + '"><span>' + x.ic + '</span><div><b>' + esc(x.t) + '</b><i>' + esc(x.b) + '</i></div></div>').join('') + '</div>' : '')
      + '<div class="ex-db-h">WING</div><div class="ex-db-ships">' + a.ships.map((k) => {
          const d = (o.dmg || {})[k] || 0, xp = (o.xp || {})[k] | 0;
          const up = (r.ranked || []).filter((q) => q.key === k)[0];
          return '<div class="ex-db-sh">' + shipImg(k, 'ex-db-art')
            + '<div><b>' + esc(((window.CONFIG.SHIP_BY_KEY || {})[k] || {}).name || k) + '</b>'
            + '<i>+' + fmt(xp) + ' expedition XP' + (up ? ' · <u>RANK ' + X().RANK_ROMAN[up.rank] + '</u>' : '') + (d > 0 ? ' · <s>−' + Math.round(d * 100) + '% hull</s>' : '') + '</i></div></div>';
        }).join('') + '</div>'
      + '<div class="sheet-actions"><button class="btn gold" data-x>Log it</button></div></div>';
    const v = sheet(h);
    if (v) v.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('[data-x]')) { closeSheet(); render(); } });
    render();
    try { window.UI.refreshAll(); } catch (e) {}
  }

  // ===========================================================================
  // WIRING
  // ===========================================================================
  document.addEventListener('click', (e) => {
    const t = e.target; if (!t || !t.closest) return;
    if (!X()) return;
    const m = t.closest('[data-mission]'); if (m && !m.disabled) { openAssign(m.dataset.mission); return; }
    const d = t.closest('[data-debrief]'); if (d) { openDebrief(d.dataset.debrief); return; }
    const rc = t.closest('[data-recall]'); if (rc) { confirmRecall(rc.dataset.recall); return; }
    const fx = t.closest('[data-fix]'); if (fx) {
      const r = X().repairNow(fx.dataset.fix);
      if (!r.ok) toast(r.reason === 'iron' ? 'Need ◆' + fmt((r.cost || {}).iron || 0) + ' ore for emergency repairs' : 'Nothing to repair');
      else toast('🔧 Hull repaired');
      render(); try { window.UI.refreshAll(); } catch (er) {}
    }
  });
  function confirmRecall(id) {
    const a = X().byId(id); if (!a) return;
    const v = sheet('<div class="ex-sheet"><div class="ex-db-k">RECALL THE WING</div>'
      + '<div class="ex-db-t" style="color:#e6c765">Abort ' + esc(a.name) + '?</div>'
      + '<div class="ex-db-s">The survey is abandoned. <b>No rewards, no damage</b> — half the fuel (⬢ ' + fmt(Math.floor(a.fuel / 2)) + ') comes back and the hulls are free immediately.</div>'
      + '<div class="sheet-actions"><button class="btn" data-x>Keep going</button><button class="btn gold" data-yes>Recall</button></div></div>');
    if (!v) return;
    v.addEventListener('click', (e) => {
      if (e.target.closest('[data-x]')) { closeSheet(); return; }
      if (e.target.closest('[data-yes]')) {
        const r = X().recall(id);
        closeSheet();
        if (r.ok) toast('Wing recalled — ⬢' + fmt(r.back) + ' fuel returned');
        render(); try { window.UI.refreshAll(); } catch (er) {}
      }
    });
  }

  // live clocks — only while the screen is actually on
  function startTicker() {
    stopTicker();
    _timer = setInterval(() => {
      const sc = $('screen-expo');
      if (!sc || !sc.classList.contains('active') || document.hidden) { stopTicker(); return; }
      head();
      let reRender = false;
      X().active().forEach((a) => {
        const card = document.querySelector('[data-exp="' + a.id + '"]'); if (!card) return;
        const back = X().returned(a);
        if (back !== card.classList.contains('back')) { reRender = true; return; }
        const p = X().progress(a);
        const bar = card.querySelector('.ex-bar > i'); if (bar) bar.style.width = (p * 100).toFixed(1) + '%';
        const eta = card.querySelector('.ex-eta');
        if (eta) eta.innerHTML = dur(Math.max(0, a.t1 - (window.SERVERTIME ? SERVERTIME.now() : Date.now()))) + ' remaining <i>· lands ' + clock(a.t1) + '</i>';
        card.querySelectorAll('.ex-bar u').forEach((u, i) => {
          const x = (a.ev || [])[i]; if (x && x.at <= p) u.classList.add('on');
        });
      });
      if (reRender) { X().tick(); render(); }
    }, 1000);
  }
  function stopTicker() { if (_timer) { clearInterval(_timer); _timer = null; } }

  window.EXPOUI = { render, openAssign, openDebrief };
})();
