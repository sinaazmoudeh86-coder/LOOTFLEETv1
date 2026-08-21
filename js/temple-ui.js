/* =============================================================================
   temple-ui.js — THE TEMPLE · screen, in-arena pill, ticker
   ---------------------------------------------------------------------------
   The screen has one job before you enter: tell you plainly that this zone can
   take things from you. Every other screen in the game is safe; this one is not,
   and burying that in small print would be a dishonest use of the space.
   ============================================================================= */
(function () {
  'use strict';
  const T = () => window.TEMPLE;
  const G = () => window.GAME;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const num = (n) => { try { return G().formatNum(n); } catch (e) { return String(Math.round(n || 0)); } };

  function hms(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return h ? h + 'h ' + String(m).padStart(2, '0') + 'm' : m + ':' + String(x).padStart(2, '0');
  }
  const RARITY = (i) => { try { return window.CONFIG.RARITY[i] || null; } catch (e) { return null; } };

  // ---------------------------------------------------------------------------
  // SCREEN
  // ---------------------------------------------------------------------------
  function render() {
    const body = $('temple-body'); if (!body || !T()) return;
    // beta wall — same copy a non-tester would see if they found the screen
    if (T().betaOn && !T().betaOn()) {
      body.innerHTML = '<div class="tem-gate"><div class="tem-glyph">\u26e9</div>'
        + '<h3>THE TEMPLE IS SEALED</h3>'
        + '<p>A closed trial is running. Entry is by <b>access code</b> \u2014 \u2699 Settings \u25b8 Coupon code.</p></div>';
      return;
    }
    const lv = T().lvl(), gate = T().GATE_LV;

    if (!T().unlocked()) {
      body.innerHTML = '<div class="tem-gate"><div class="tem-glyph">\u26e9</div>'
        + '<h3>THE TEMPLE IS SEALED</h3>'
        + '<p>It opens at <b>Level ' + gate + '</b> \u2014 you are Level <b>' + lv + '</b>.</p>'
        + '<div class="tem-bar"><i style="width:' + Math.min(100, lv / gate * 100) + '%"></i></div>'
        + '<p class="tem-warn-lite">This is the only zone in the game where another pilot can take your gear.</p></div>';
      return;
    }

    const a = T().altar();
    const up = T().itemUp();
    const n = T().count();
    const rec = T().recent();

    let altarCard;
    if (up) {
      const r = RARITY(a.item.rarity | 0);
      altarCard = '<div class="tem-altar live">'
        + '<div class="tem-a-k">\u2726 ON THE ALTAR NOW</div>'
        + '<div class="tem-a-item" style="color:' + (r ? r.color : '#ffd24d') + ';text-shadow:0 0 18px ' + (r ? r.glow : 'rgba(255,210,77,.8)') + '">'
        + (r ? r.name.toUpperCase() : 'RELIC') + '</div>'
        + '<div class="tem-a-lvl">ITEM LEVEL ' + (a.item.ilvl | 0) + '</div>'
        + '<div class="tem-a-note">It is lying on the floor at the centre. Fly to it and it is yours \u2014 if you live.</div></div>';
    } else {
      // NO COUNTDOWN. The spawn is a random 1-3 hours and nobody is told when —
      // that is the mechanic, not a missing feature. A timer here would empty the
      // zone until the last five minutes of every cycle.
      // THE DEADLINE IS PUBLIC AND EXACT. The interval is still rolled at random
      // between one and three hours, so nobody can predict the altar after next
      // — but everyone reads the same clock for this one, which is what gets
      // people into the room at the same moment.
      const ms = T().altarMs();
      const at = new Date(Date.now() + ms);
      const soon = ms > 0 && ms < 10 * 60000;
      altarCard = '<div class="tem-altar' + (soon ? ' soon' : '') + '">'
        + '<div class="tem-a-k">' + (soon ? '\u26a0 THE ALTAR IS WAKING' : 'NEXT SPAWN') + '</div>'
        + '<div class="tem-a-clock">' + (ms > 0 ? hms(ms) : 'ANY MOMENT') + '</div>'
        + '<div class="tem-a-at">' + at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' your time</div>'
        + '<div class="tem-a-note">One item between <b>Relic</b> and <b>Paragon</b>, item level 300\u2013500. '
        + 'Each wait is a random <b>1\u20133 hours</b>, so the one after this is anyone\u2019s guess. '
        + (a && a.taken_name ? 'Last taken by <b>' + esc(a.taken_name) + '</b>.' : 'Nobody has taken one yet.') + '</div></div>';
    }

    body.innerHTML =
      '<div class="tem-hero">'
        + '<div class="tem-tag">TRUE PVP \u00b7 NO PROTECTIONS</div>'
        + '<div class="tem-title">THE TEMPLE</div>'
        + '<div class="tem-sub">One arena. Every pilot in it can kill you.</div>'
      + '</div>'
      + altarCard
      + '<div class="tem-warn">'
        + '<b>\u2620 DYING HERE COSTS WHAT DYING ALWAYS COSTS.</b>'
        + '<span>Your active hull drops to Level 1 and every resource spent upgrading it is gone. '
        + 'An item is rolled out of your hold \u2014 at Level 100+ that roll can take several. '
        + 'There is no spawn protection, no re-entry cooldown, and no matchmaking: '
        + 'you may be the strongest fleet in there or the weakest.</span>'
      + '</div>'
      + '<div class="tem-rules">'
        + '<div><i>\u26a1</i><span><b>Speed is locked to 1\u00d7</b> and autopilot is off. Both are restored when you leave.</span></div>'
        + '<div><i>\u25ce</i><span><b>No hostiles, no spawns.</b> Nothing in the Temple pays XP, gold or loot except the altar.</span></div>'
        + '<div><i>\u23f1</i><span><b>The spawn time is unknown.</b> Somewhere between one and three hours \u2014 there is no countdown, for anyone.</span></div>'
        + '<div><i>\u25ce</i><span><b>Hold the altar and it spawns better.</b> Every second you are ALONE inside the ring banks vigil, and vigil bends the roll toward the top tiers. Two pilots in the ring bank nothing \u2014 one of you has to leave.</span></div>'
        + '<div><i>\u2694</i><span><b>Kills are reported by the attacker</b> and checked by the server for range and presence.</span></div>'
      + '</div>'
      + '<div class="tem-live"><span class="tem-dot' + (n ? ' on' : '') + '"></span>'
        + (n ? '<b>' + n + '</b> pilot' + (n === 1 ? '' : 's') + ' in the Temple right now' : 'The Temple is empty') + '</div>'
      + (rec.length ? '<div class="tem-feed"><div class="tem-feed-h">RECENT KILLS</div>'
          + rec.slice(0, 8).map((k) => '<div class="tem-fr"><b>' + esc(k.killer || '?') + '</b> downed <span>' + esc(k.victim || '?') + '</span></div>').join('')
          + '</div>' : '')
      + '<button class="tem-go" id="tem-enter">\u26e9 ENTER THE TEMPLE</button>';

    const b = $('tem-enter');
    if (b) b.addEventListener('click', () => { if (T().enter()) { const nav = document.querySelector('.nav-btn[data-screen="battle"]'); if (nav) nav.click(); } });
  }

  // ---------------------------------------------------------------------------
  // IN-ARENA PILL
  // ---------------------------------------------------------------------------
  function ensurePill() {
    removePill();
    const host = $('top-stack') || $('app') || document.body;
    const p = document.createElement('div');
    p.id = 'tem-pill';
    host.appendChild(p);
    syncPill();
    // ONLY the LEAVE chip is clickable. The pill carries a live countdown people
    // will look at constantly, and making the whole thing an exit button meant
    // one stray tap dropped you out of a zone you had been holding for an hour.
    p.addEventListener('click', (ev) => {
      const hit = ev.target && ev.target.closest && ev.target.closest('.tp-x');
      if (!hit) return;
      ev.stopPropagation();
      doLeave();
    });
  }
  function removePill() { const p = $('tem-pill'); if (p) p.remove(); }
  // Leaving is instant and safe — no penalty, nothing dropped. It is confirmed
  // only because an accidental exit costs a vigil you cannot get back.
  let _confirmT = 0;
  function doLeave() {
    const p = $('tem-pill');
    if (Date.now() - _confirmT > 3000) {
      _confirmT = Date.now();
      if (p) { const x = p.querySelector('.tp-x'); if (x) { x.textContent = 'SURE?'; x.classList.add('arm'); } }
      setTimeout(() => { const q = $('tem-pill'); if (q && Date.now() - _confirmT >= 3000) { const x2 = q.querySelector('.tp-x'); if (x2) { x2.textContent = 'LEAVE'; x2.classList.remove('arm'); } } }, 3100);
      return;
    }
    _confirmT = 0;
    try { if (G().endTemple) G().endTemple(); } catch (e) {}
    try { G().goSafeHangar && G().goSafeHangar(); } catch (e) {}
    try { window.UI && window.UI.showScreen && window.UI.showScreen('temple'); } catch (e) {}
    removePill();
  }
  function syncPill() {
    const p = $('tem-pill'); if (!p || !T()) return;
    const up = T().itemUp();
    const v = T().vigil ? T().vigil() : 0;
    const hold = T().holding && T().holding();
    const left = T().altarMs();
    p.className = up ? 'live' : (left > 0 && left < 600000) ? 'soon' : hold ? 'hold' : '';
    p.innerHTML = '<span class="tp-c">\u26e9</span>'
      + '<span class="tp-n">' + T().count() + '</span>'
      + '<span class="tp-a">' + (up ? '\u2726 ALTAR UP' : hms(T().altarMs())) + '</span>'
      + (hold || v > 0 ? '<span class="tp-v">\u25ce ' + Math.floor(v / 60) + 'm</span>' : '')
      + '<span class="tp-x">LEAVE</span>';
  }

  // THE COMMAND CARD IS A LIVE READOUT. "The Temple" with no numbers is a door
  // nobody opens; "3 pilots · altar 12m" is a reason to fly. One cheap RPC,
  // only while the Command sheet is actually on screen, never faster than 15s.
  let _stT = 0, _st = null;
  // The card is display:none in CSS and revealed only for beta accounts —
  // CSS-first so non-testers never see it flash on boot.
  function revealCard() {
    const c = document.querySelector('.mega-card.cmd-temple');
    if (!c) return;
    const on = !!(T() && T().betaOn && T().betaOn());
    c.classList.toggle('beta-on', on);
    c.style.removeProperty('display');   // clear the old inline attempt
  }
  async function pollStatus() {
    const card = document.querySelector('.mega-card.cmd-temple .mc-n'); if (!card) return;
    const c = (window.CLOUD && window.CLOUD.enabled && window.CLOUD.client) || null; if (!c) return;
    if (Date.now() - _stT < 15000) { paintStatus(); return; }
    _stT = Date.now();
    try { const r = await c.rpc('temple_status'); if (!r.error) _st = r.data || null; } catch (e) {}
    paintStatus();
  }
  function paintStatus() {
    const card = document.querySelector('.mega-card.cmd-temple .mc-n'); if (!card) return;
    let em = card.querySelector('.tem-card-live');
    if (!em) { em = document.createElement('em'); em.className = 'sd-live-tag tem-card-live'; card.appendChild(em); }
    if (!_st) { em.textContent = 'PVP'; return; }
    const n = Number(_st.pilots) || 0;
    if (_st.item_up) { em.textContent = '\u2726 ITEM UP \u00b7 ' + n + ' IN'; em.style.color = '#ffd24d'; em.style.borderColor = 'rgba(255,210,77,.6)'; return; }
    let left = '';
    try {
      const at = Date.parse(_st.next_at || ''), sv = Date.parse(_st.now || '') || Date.now();
      const ms = Math.max(0, at - sv);
      left = ms > 0 ? (ms >= 3600000 ? Math.floor(ms / 3600000) + 'h' + Math.floor((ms % 3600000) / 60000) + 'm' : Math.floor(ms / 60000) + 'm') : 'soon';
    } catch (e) {}
    em.textContent = (n ? n + ' IN \u00b7 ' : '') + (left ? '\u26e9 ' + left : 'PVP');
    em.style.color = n ? '#ff8a96' : '#c98bff';
    em.style.borderColor = n ? 'rgba(255,107,122,.5)' : 'rgba(201,139,255,.5)';
  }

  // keep the screen and the pill honest without a render loop
  setInterval(() => {
    if (document.hidden) return;
    try {
      if (document.querySelector('#screen-temple.active')) { T().poll(false); render(); }
      revealCard();
      if (T() && T().betaOn && T().betaOn() && document.querySelector('.mega-card.cmd-temple')) pollStatus();
      if (T() && T().active()) { if (!$('tem-pill')) ensurePill(); else syncPill(); }
      else removePill();
    } catch (e) {}
  }, 2000);

  // The coupon calls revealCard() the instant it grants, but the Command sheet
  // may not be built yet on a fresh load — so also try on boot and let the 2s
  // loop keep it honest.
  try { revealCard(); } catch (e) {}
  window.TEMPLEUI = { render, ensurePill, removePill, syncPill, revealCard };
})();
