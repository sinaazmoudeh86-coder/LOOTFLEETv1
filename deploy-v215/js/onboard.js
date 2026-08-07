/* =============================================================================
   onboard.js — the authored first five minutes
   ---------------------------------------------------------------------------
   TWO MECHANISMS, ONE SEQUENCE.

   1. A STEP MACHINE. state.onboard says what the game is asking for right now.
      It advances only when the player ACTUALLY DOES the thing — detected by
      polling the game's own numbers against a baseline taken when the step
      armed, never by binding to a button. So it works however the player got
      there, survives any re-render, and a missing highlight target still
      completes. Worst failure is a prompt with no arrow, never a soft-lock.

   2. PROGRESSIVE REVEAL. No interface element appears before the player has the
      thing it displays. No gold counter until there is gold. No Hangar until a
      hull is affordable. No nav at all for the first twenty seconds. Each piece
      of chrome arrives on a beat, as a small reward, so the opening has shape
      instead of being a wall of controls with an arrow pointing at one.

   IT FAILS OPEN, ALWAYS.
   Hiding load-bearing chrome is the risky half, so every path out of this file
   ends with everything visible:
     · anything but a brand-new account is released on sight
     · any exception anywhere releases immediately
     · a hard 4-minute ceiling releases regardless of progress
     · window.ONBOARD.skip() releases from the console
   The tutorial is allowed to break. The game is not.
   ============================================================================= */
(function () {
  'use strict';

  const G = () => window.GAME;
  const S = () => { const g = G(); return g && g.state; };
  const MAX_MS = 4 * 60 * 1000;            // hard ceiling — release no matter what
  let started = 0, released = false;
  // ---- what the interface shows, and when ------------------------------------
  // Each entry appears when the step machine REACHES that index. Everything not
  // listed is visible from the start.
  const REVEAL = [
    { at: 1, sel: '[data-ob="gold"]',      why: 'the first gold has been banked' },
    { at: 3, sel: '[data-ob="res"]',       why: 'resources start dropping' },
    { at: 3, sel: '#nav',                  why: 'there is somewhere to go' },
    { at: 4, sel: '#nav-command',          why: 'systems exist to open' },
    { at: 5, sel: '[data-ob="premium"]',   why: 'released — everything is on' },
  ];

  const STEPS = [
    {
      id: 'watch',
      title: 'Your fleet fires on its own',
      body: 'Wreckage is loot. It flies to you automatically.',
      read: (s) => s.totalKills | 0,
      done: (now, base) => now >= base + 3,
    },
    {
      id: 'up1',
      title: 'Spend that gold on damage',
      body: 'Open your ship and take an upgrade. Watch how much faster things die.',
      target: '#ship-upgrade',
      read: () => hullLevels(),
      done: (now, base) => now > base,
    },
    {
      id: 'up2',
      title: 'Again \u2014 that\u2019s the whole game',
      body: 'Kill, bank gold, upgrade, go deeper. Everything else is built on this.',
      target: '#ship-upgrade',
      read: () => hullLevels(),
      done: (now, base) => now > base,
    },
    {
      id: 'ship',
      title: 'Put a second hull in the air',
      body: 'Escorts fight beside you and never stop. Buy one from the Hangar.',
      target: '[data-ht="ships"], [data-go="shipworks"]',
      read: (s) => Object.keys(s.ownedShips || {}).length,
      done: (now, base) => now > base,
    },
    {
      id: 'mission',
      title: 'Take a mission',
      body: 'Missions tell you what to aim for next \u2014 and pay you for getting there.',
      target: '[data-go="missions"]',
      read: (s) => s.lifetimeMissions | 0,
      done: (now, base) => now > base,
    },
  ];

  function hullLevels() {
    const s = S(); if (!s) return 0;
    const sl = s.shipLevels || {}; let t = 0;
    for (const k in sl) t += sl[k] | 0;
    return t;
  }

  const step = () => { const s = S(); return s ? (s.onboard | 0) : 999; };
  const isDone = () => step() >= STEPS.length;

  // ---- tagging ----------------------------------------------------------------
  // Chips are marked once so the reveal rules never depend on DOM order or on
  // :has() support. Anything we can't find is simply never hidden.
  let tagged = false;
  function tag() {
    if (tagged) return;
    tagged = true;
    const chip = (id) => { const e = document.getElementById(id); return e && e.closest ? e.closest('.res-chip') : null; };
    const set = (el, v) => { if (el && !el.dataset.ob) el.dataset.ob = v; };
    set(chip('hud-gold'), 'gold');
    ['hud-fuel', 'hud-iron', 'hud-plasma', 'hud-prism'].forEach((id) => set(chip(id), 'res'));
    ['hud-dread', 'hud-lc-chip'].forEach((id) => { const e = document.getElementById(id); set(e, 'premium'); });
  }

  function applyReveal() {
    if (released) return;
    const i = step();
    REVEAL.forEach((r) => {
      document.querySelectorAll(r.sel).forEach((el) => {
        const hide = i < r.at;
        if (hide) { if (!el.classList.contains('ob-hide')) el.classList.add('ob-hide'); }
        else if (el.classList.contains('ob-hide')) {
          el.classList.remove('ob-hide');
          el.classList.add('ob-arrive');
          setTimeout(() => el.classList.remove('ob-arrive'), 900);
        }
      });
    });
  }

  // The auth screen is a full-page takeover rendered over the game, so a prompt
  // bar pinned to the viewport lands on top of it — it was covering the password
  // field on the Create Account form. Suspend while it is up, don't release:
  // the player is still brand new and the sequence should resume once they are
  // through the gate.
  function gated() {
    try {
      const l = document.getElementById('login');
      if (l && l.offsetParent !== null) return true;
      const n = document.getElementById('first-name-gate');
      if (n && n.offsetParent !== null) return true;
    } catch (e) {}
    return false;
  }

  // Hide the tutorial's own furniture without ending the sequence.
  function suspend() {
    if (bar) { bar.remove(); bar = null; }
    document.querySelectorAll('.ob-ring').forEach((e) => e.classList.remove('ob-ring'));
    document.querySelectorAll('.ob-hide').forEach((e) => e.classList.remove('ob-hide'));
    armed = -1;                            // re-arm (and re-baseline) on resume
  }

  // The one function that matters: put the interface back, permanently.
  function release() {
    released = true;
    document.querySelectorAll('.ob-hide').forEach((e) => e.classList.remove('ob-hide'));
    document.querySelectorAll('.ob-ring').forEach((e) => e.classList.remove('ob-ring'));
    if (bar) { bar.remove(); bar = null; }
  }

  // ---- prompt -----------------------------------------------------------------
  let bar = null, baseline = null, armed = -1;

  function ui() {
    if (bar) return bar;
    bar = document.createElement('div');
    bar.className = 'ob-bar';
    bar.innerHTML = '<div class="ob-n"></div><div class="ob-tx"><b></b><span></span></div>' +
                    '<button class="ob-skip" type="button">Skip</button>';
    // SKIP means "let me play" — it silences the walkthrough AND the coach tips,
    // for good. A player who opts out once should never be taught again by
    // either system, so this writes both flags rather than just dismissing.
    bar.querySelector('.ob-skip').addEventListener('click', () => {
      const s = S();
      if (s) {
        s.onboard = STEPS.length;
        s.coach = s.coach || { seen: {} };
        s.coach.allSeen = true;
        try { G().save(); } catch (e) {}
      }
      try { if (window.COACH && window.COACH.silence) window.COACH.silence(); } catch (e) {}
      release();
    });
    document.body.appendChild(bar);
    return bar;
  }

  function ring(sel) {
    document.querySelectorAll('.ob-ring').forEach((e) => e.classList.remove('ob-ring'));
    if (!sel) return;
    for (const s of sel.split(',')) {
      const el = document.querySelector(s.trim());
      if (el) { el.classList.add('ob-ring'); return; }
    }
  }

  function paint() {
    const i = step();
    if (isDone()) { release(); return; }
    const st = STEPS[i], b = ui();
    b.querySelector('.ob-n').textContent = (i + 1) + '/' + STEPS.length;
    b.querySelector('b').textContent = st.title;
    b.querySelector('span').textContent = st.body;
    ring(st.target);
  }

  function arm() {
    const i = step(), s = S();
    if (isDone() || !s || armed === i) return;
    armed = i;
    baseline = STEPS[i].read(s);
    applyReveal();
    paint();
  }

  function advance() {
    const s = S(); if (!s) return;
    s.onboard = (s.onboard | 0) + 1;
    try { G().save(); } catch (e) {}
    applyReveal();
    if (isDone()) {
      release();
      try {
        if (window.UI && window.UI.unlockToast) {
          window.UI.unlockToast('\u2713 The galaxy is yours \u2014 new systems unlock as you level');
        }
      } catch (e) {}
      return;
    }
    arm();
    try {
      const t = document.createElement('div');
      t.className = 'lvl-toast'; t.style.color = '#5fd1ff'; t.style.fontSize = '18px';
      t.textContent = '\u2713 ' + STEPS[step() - 1].title;
      (document.getElementById('toasts') || document.body).appendChild(t);
      setTimeout(() => t.remove(), 2600);
    } catch (e) {}
  }

  // Anyone who has clearly played before is released on sight.
  function seed() {
    const s = S(); if (!s) return false;
    if (s.onboard === undefined) {
      const played = (s.level | 0) > 3 || (s.lifetimeMissions | 0) > 0 ||
                     (s.pasc && (s.pasc.stars | 0) > 0) || (s.totalKills | 0) > 400 ||
                     Object.keys(s.ownedShips || {}).length > 2;
      s.onboard = played ? STEPS.length : 0;
      try { G().save(); } catch (e) {}
    }
    // BELT AND BRACES ON ASCENSION. `onboard` is in ASC_KEEP so it should survive,
    // but ascension resets level to 1 — the exact signal this file reads as "new
    // player". If the flag were ever dropped from that list, a veteran would be
    // walked through "spend gold on damage" after every single ascension. An
    // ascended pilot is never taught anything, whatever the flag says.
    if (s.pasc && (s.pasc.stars | 0) > 0 && (s.onboard | 0) < STEPS.length) {
      s.onboard = STEPS.length;
      try { G().save(); } catch (e) {}
    }
    return true;
  }

  function tick() {
    if (released) return;
    try {
      const s = S(); if (!s) return;
      if (gated()) { suspend(); started = Date.now(); return; }   // clock doesn't run behind the auth gate
      if (!seed()) return;
      if (isDone()) { release(); return; }
      if (started && Date.now() - started > MAX_MS) { release(); return; }
      tag(); arm();
      const st = STEPS[step()];
      if (st.done(st.read(s), baseline)) advance();
      else { ring(st.target); applyReveal(); }
    } catch (e) {
      // Never leave a player without an interface because of a tutorial bug.
      try { console.warn('[ONBOARD] released after error:', e); } catch (e2) {}
      release();
    }
  }

  function boot() {
    // After the cloud save has landed, so we judge the real account rather than
    // a blank local state that is about to be replaced by it.
    setTimeout(() => {
      try {
        started = Date.now();
        if (!seed()) { release(); return; }
        if (isDone()) { release(); return; }
        if (!gated()) { tag(); arm(); }
        setInterval(tick, 800);
        // Backstop for the case where the tick loop itself stops running. Re-checks
        // rather than firing blind, so time spent on the auth screen doesn't burn it.
        setInterval(() => {
          if (!released && started && Date.now() - started > MAX_MS) release();
        }, 15000);
      } catch (e) { release(); }
    }, 6000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  const css = document.createElement('style');
  css.textContent = `
  .ob-hide{display:none !important}
  .ob-arrive{animation:obArrive .62s cubic-bezier(.2,.9,.3,1.25)}
  @keyframes obArrive{from{opacity:0;transform:translateY(-7px) scale(.94)}to{opacity:1;transform:none}}
  .ob-bar{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(env(safe-area-inset-bottom,0px) + 74px);
    z-index:7000;display:flex;align-items:center;gap:11px;max-width:min(440px,calc(100vw - 24px));
    padding:11px 15px 11px 12px;border-radius:13px;pointer-events:none;
    background:linear-gradient(180deg,rgba(20,28,42,.97),rgba(11,16,26,.97));
    border:1px solid rgba(95,209,255,.35);box-shadow:0 14px 40px -12px rgba(0,0,0,.85),0 0 26px -14px rgba(95,209,255,.7);
    animation:obIn .38s cubic-bezier(.2,.9,.3,1.2)}
  @keyframes obIn{from{opacity:0;transform:translateX(-50%) translateY(14px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
  .ob-n{flex:0 0 auto;font-family:'Orbitron',sans-serif;font-weight:800;font-size:10px;letter-spacing:.06em;
    color:#0a1119;background:linear-gradient(180deg,#7fdcff,#3aa9e0);border-radius:7px;padding:5px 7px}
  .ob-tx{min-width:0}
  .ob-tx b{display:block;font-family:'Rajdhani',sans-serif;font-weight:700;font-size:14px;color:#eaf5ff;line-height:1.25}
  .ob-tx span{display:block;font-size:11.5px;line-height:1.4;color:#8fb0c8;margin-top:1px}
  .ob-skip{flex:0 0 auto;pointer-events:auto;cursor:pointer;align-self:stretch;
    background:none;border:none;border-left:1px solid rgba(255,255,255,.1);margin-left:2px;
    padding:0 4px 0 12px;color:#61748c;font-family:'Rajdhani',sans-serif;font-weight:700;
    font-size:12px;letter-spacing:.05em;min-width:44px;min-height:40px}
  .ob-skip:hover{color:#a9bccf}
  .ob-ring{outline:2px solid rgba(95,209,255,.85);outline-offset:3px;border-radius:12px;
    animation:obPulse 1.9s ease-in-out infinite}
  @keyframes obPulse{0%,100%{box-shadow:0 0 0 0 rgba(95,209,255,.5)}50%{box-shadow:0 0 0 9px rgba(95,209,255,0)}}
  @media (prefers-reduced-motion:reduce){.ob-bar,.ob-ring,.ob-arrive{animation:none}}
  `;
  document.head.appendChild(css);

  window.ONBOARD = {
    step, isDone, STEPS, release,
    reset() { const s = S(); if (s) { s.onboard = 0; armed = -1; released = false; started = Date.now(); G().save(); tag(); arm(); } },
    skip()  { const s = S(); if (s) { s.onboard = STEPS.length; G().save(); } release(); },
  };
})();
