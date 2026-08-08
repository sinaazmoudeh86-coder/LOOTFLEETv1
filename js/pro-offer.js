/* =============================================================================
   pro-offer.js — LOOTFLEET PRO contextual upgrade offer
   -----------------------------------------------------------------------------
   A hero sheet that appears at moments where Pro would have just helped, and
   NOWHERE else. The design brief was "don't spam it", so the restraint is the
   feature — every rule below exists to make the offer rare:

     · Pro members never see it. Ever.
     · Nothing before level 10 — a pilot who has not met the game cannot judge
       an upgrade to it.
     · Never mid-combat. If a trigger fires during a battle the offer is QUEUED
       and shown on the next quiet screen, so it can never cost a run.
     · Every trigger fires AT MOST ONCE for the lifetime of the account. The
       offer is an argument, not a nag: once a pilot has heard "your empire is
       full and Pro carries ten more systems", repeating it adds nothing.
     · A global cooldown on top of that — 20 h between any two offers — so two
       triggers landing in one session cannot double up.
     · Dismissals compound: brush it off twice and the cooldown becomes 3 days,
       four times and it becomes a week. Saying no makes it quieter, which is
       the behaviour a player deserves for answering honestly.

   Each trigger names the benefit the player just wanted, in their own context —
   the numbers come from PRO_PERKS via GAME.proMods(), never retyped.
   ========================================================================== */
(function () {
  'use strict';
  const G = () => window.GAME;
  const MIN_LEVEL = 10;
  const BASE_COOLDOWN = 20 * 3600 * 1000;    // 20 h between any two offers
  const COOLDOWN_AFTER = [0, 0, 3 * 864e5, 3 * 864e5, 7 * 864e5];   // by dismissal count

  // ---- the triggers ---------------------------------------------------------
  // headline: what the player just hit. lead: the Pro answer to exactly that.
  // NOTE there is deliberately no 'speed' trigger: tapping the locked 5× tier in
  // the HUD already opens the Pro sheet directly, which is a better response than
  // a pop-up — the player asked, so answer, don't interrupt.
  const TRIGGERS = {
    tilecap: {
      icon: '⬡',
      headline: 'YOUR EMPIRE IS FULL',
      lead: (k) => 'You are holding every system your command can support. Pro raises the cap by ' + k.tiles + ' tiles, and every one of them pays hourly income while you are offline.',
    },
    dreadlock: {
      icon: '☠',
      headline: 'THAT HUNT IS SPENT',
      lead: () => 'This Dreadnaught tier is done for the week. Pro members get one extra hunt at every tier, every week — a second shot at the cores that buy your Pilot Tree.',
    },
    levelgrind: {
      icon: '✨',
      headline: 'THE CURVE IS GETTING STEEP',
      lead: (k) => 'Levels past 100 cost real time now. Pro multiplies your base XP rate by ' + k.xpMult + '× — and because every bonus you own is a percentage OF that base, it multiplies all of them at once.',
    },
    offline: {
      icon: '◷',
      headline: 'WHILE YOU WERE GONE',
      lead: (k) => 'Your empire earned all night. Pro would have paid ' + k.gold + '× the gold on every kill you make when you get back, and ' + k.tiles + ' more systems could have been earning beside it.',
    },
  };

  function st() {
    const s = G().state;
    if (!s.proOffer) s.proOffer = { last: 0, seen: {}, dismissed: 0 };
    if (!s.proOffer.seen) s.proOffer.seen = {};
    return s.proOffer;
  }
  function isPro() { try { return !!(G().isPro && G().isPro()); } catch (e) { return false; } }
  function inCombat() {
    try {
      // The live class is `active` (set in ui-v94 showScreen). This read `.on`,
      // so it ALWAYS returned false — the "never mid-combat" promise in the
      // docstring above was not implemented, and `_queued`/`flush()` were dead
      // code because nothing ever queued.
      const scr = document.querySelector('.nav-btn.active[data-screen]');
      return !!(scr && scr.dataset.screen === 'battle');
    } catch (e) { return false; }
  }
  function cooldown() {
    const d = st().dismissed | 0;
    return Math.max(BASE_COOLDOWN, COOLDOWN_AFTER[Math.min(d, COOLDOWN_AFTER.length - 1)] || 0);
  }
  function allowed(key) {
    if (!G() || !G().state) return false;
    if (isPro()) return false;
    if ((G().state.level | 0) < MIN_LEVEL) return false;
    const s = st();
    if (s.seen[key]) return false;                       // one shot per trigger, for life
    if (Date.now() - (s.last || 0) < cooldown()) return false;
    return true;
  }

  let _queued = null;
  // The single entry point. Call it from the moment the player felt the limit.
  function maybe(key) {
    if (!TRIGGERS[key] || !allowed(key)) return false;
    if (inCombat()) { _queued = key; return false; }     // never interrupt a run
    show(key);
    return true;
  }
  // Called on screen changes — drains a trigger that fired mid-combat.
  function flush() {
    if (!_queued) return;
    const k = _queued;
    if (!allowed(k) || inCombat()) { if (!allowed(k)) _queued = null; return; }
    _queued = null;
    show(k);
  }

  function show(key) {
    const t = TRIGGERS[key]; if (!t) return;
    const s = st();
    s.seen[key] = 1; s.last = Date.now();
    try { G().save(); } catch (e) {}

    const k = (() => { try { return G().proMods().perks; } catch (e) { return { xpMult: 5, speed: 5, gold: 2, loot: 1.5, tiles: 10 }; } })();
    boot();
    const old = document.getElementById('pro-offer-veil'); if (old) old.remove();
    const v = document.createElement('div');
    v.id = 'pro-offer-veil';
    v.innerHTML =
      '<div class="pof-card" role="dialog" aria-label="LootFleet Pro offer">' +
        '<button class="pof-x" data-x aria-label="Close">✕</button>' +
        '<div class="pof-hero">' +
          '<div class="pof-glow"></div>' +
          '<div class="pof-ic">' + t.icon + '</div>' +
          '<div class="pof-tag">LOOTFLEET PRO</div>' +
          '<div class="pof-head">' + t.headline + '</div>' +
        '</div>' +
        '<p class="pof-lead">' + t.lead(k) + '</p>' +
        '<div class="pof-perks">' +
          row('✨', k.xpMult + '× XP', 'on every kill, account-wide') +
          row('⚡', k.speed + '× speed', 'the exclusive battle tier') +
          row('$', k.gold + '× gold', 'from every wreck') +
          row('❖', '+' + Math.round((k.loot - 1) * 100) + '% loot', 'drop chance on every kill') +
          row('⬡', '+' + k.tiles + ' systems', 'more empire, more hourly income') +
          row('☠', '+1 hunt', 'per Dreadnaught tier each week') +
        '</div>' +
        '<button class="pof-go" data-go>Go Pro — $19.99 / month</button>' +
        '<button class="pof-no" data-no>Not now</button>' +
      '</div>';
    document.body.appendChild(v);
    const close = (dismissed) => {
      if (dismissed) { const s2 = st(); s2.dismissed = (s2.dismissed | 0) + 1; try { G().save(); } catch (e) {} }
      v.classList.add('out');
      setTimeout(() => v.remove(), 180);
    };
    v.querySelector('[data-x]').onclick = () => close(true);
    v.querySelector('[data-no]').onclick = () => close(true);
    v.querySelector('[data-go]').onclick = () => {
      close(false);
      try { if (window.UI && window.UI.openProSheet) window.UI.openProSheet(); } catch (e) {}
    };
    v.onclick = (e) => { if (e.target === v) close(true); };
  }
  function row(ic, big, sub) {
    return '<div class="pof-row"><i>' + ic + '</i><b>' + big + '</b><span>' + sub + '</span></div>';
  }

  function boot() {
    if (document.getElementById('pro-offer-css')) return;
    const s = document.createElement('style');
    s.id = 'pro-offer-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  const CSS = `
  #pro-offer-veil{ position:fixed; inset:0; z-index:9600; display:grid; place-items:center; padding:18px;
    background:rgba(4,8,14,.78); backdrop-filter:blur(6px); animation:pofIn .22s ease; }
  #pro-offer-veil.out{ animation:pofOut .18s ease forwards; }
  @keyframes pofIn{ from{ opacity:0 } to{ opacity:1 } }
  @keyframes pofOut{ to{ opacity:0 } }
  .pof-card{ width:min(380px,100%); max-height:calc(100vh - 36px); overflow-y:auto; position:relative;
    background:linear-gradient(180deg,#101a2c,#0a1120); border:1px solid #2c4a6e; border-radius:18px; padding:0 16px 16px;
    box-shadow:0 30px 70px -20px rgba(0,0,0,.9), 0 0 0 1px rgba(95,209,255,.16); animation:pofUp .26s cubic-bezier(.2,1,.35,1); }
  @keyframes pofUp{ from{ transform:translateY(16px) scale(.98); opacity:0 } to{ transform:none; opacity:1 } }
  .pof-x{ position:absolute; top:10px; right:10px; z-index:2; width:30px; height:30px; border-radius:50%; cursor:pointer;
    border:1px solid rgba(255,255,255,.14); background:rgba(8,14,24,.7); color:#9fb4cf; font-size:12px; }
  .pof-hero{ position:relative; margin:0 -16px 14px; padding:26px 18px 18px; overflow:hidden; text-align:center;
    border-radius:18px 18px 0 0; background:linear-gradient(180deg,#1a2740,#111a2c); border-bottom:1px solid rgba(95,209,255,.2); }
  .pof-glow{ position:absolute; inset:-40% -20% auto; height:160px; pointer-events:none;
    background:radial-gradient(60% 100% at 50% 0%, rgba(95,209,255,.34), transparent 70%); }
  .pof-ic{ position:relative; font-size:30px; line-height:1; margin-bottom:9px; filter:drop-shadow(0 0 12px rgba(95,209,255,.7)); }
  .pof-tag{ position:relative; font-family:'Orbitron',sans-serif; font-weight:800; font-size:9px; letter-spacing:.22em; color:#5fd1ff; margin-bottom:7px; }
  .pof-head{ position:relative; font-family:'Orbitron',sans-serif; font-weight:900; font-size:16px; letter-spacing:.04em; color:#eaf2fb; line-height:1.25; }
  .pof-lead{ margin:0 0 14px; font-size:12.5px; line-height:1.6; color:#c3d2e6; text-wrap:pretty; }
  .pof-perks{ display:grid; gap:1px; background:rgba(255,255,255,.07); border:1px solid rgba(255,255,255,.09); border-radius:12px; overflow:hidden; margin-bottom:14px; }
  .pof-row{ display:grid; grid-template-columns:26px auto 1fr; align-items:baseline; gap:8px; padding:9px 11px; background:#0d1626; }
  .pof-row i{ font-style:normal; font-size:13px; color:#5fd1ff; text-align:center; }
  .pof-row b{ font-family:'Orbitron',sans-serif; font-size:11.5px; font-weight:800; color:#fff; white-space:nowrap; }
  .pof-row span{ font-size:11px; color:#8fa3bd; line-height:1.4; }
  .pof-go{ width:100%; border:none; border-radius:12px; padding:14px; cursor:pointer; display:block;
    font-family:'Orbitron',sans-serif; font-weight:800; font-size:12.5px; letter-spacing:.06em; color:#06131f;
    background:linear-gradient(180deg,#9fe4ff,#5fd1ff); box-shadow:0 10px 24px -10px rgba(95,209,255,.9); }
  .pof-go:active{ transform:scale(.985); }
  .pof-no{ width:100%; margin-top:8px; border:none; background:none; cursor:pointer; padding:10px;
    font-size:11.5px; color:#7d90a8; }
  `;

  window.PROOFFER = { maybe, flush, TRIGGERS };
})();
